import { spawn, spawnSync } from "node:child_process";
import { X509Certificate, createHash } from "node:crypto";
import fs from "node:fs/promises";
import { openSync, closeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertTestSigningEnvironment,
  getSigningProductVersion,
  SIGNING_PHASES,
  TEST_CERTIFICATE_SHA256,
  unsignedPeDigest,
  verifyTestSignature,
  waitForFile,
  writeSigningRecord,
  type SigningPhase,
} from "./windows-signing.ts";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const queue = path.join(root, ".task/signpath");
const release = path.join(root, "apps/electron/release");

function phaseArgument(): SigningPhase {
  const phase = (process.env.SIGNPATH_PHASE ?? process.argv[3]) as SigningPhase;
  if (!SIGNING_PHASES.includes(phase)) throw new Error("Unknown signing phase");
  return phase;
}

async function main() {
  assertTestSigningEnvironment();
  if (process.platform !== "win32")
    throw new Error("Windows signing requires Windows");
  const operation = process.argv[2] ?? process.env.SIGNPATH_OPERATION;
  if (operation === "preflight") {
    if (!process.env.SIGNPATH_API_TOKEN?.trim())
      throw new Error("Configure the SIGNPATH_API_TOKEN Actions Secret first");
    if (!process.env.SIGNPATH_TEST_CERTIFICATE_BASE64?.trim())
      throw new Error(
        "Configure the SIGNPATH_TEST_CERTIFICATE_BASE64 Actions Secret first",
      );
  } else if (operation === "start") {
    const certificate = new X509Certificate(
      await fs.readFile(path.join(queue, "test-certificate.cer")),
    );
    if (
      certificate.fingerprint256.replaceAll(":", "").toLowerCase() !==
      TEST_CERTIFICATE_SHA256
    ) {
      throw new Error("The pinned test certificate changed");
    }
    await fs.mkdir(queue, { recursive: true });
    const descriptor = openSync(path.join(queue, "build.log"), "wx");
    const child = spawn(
      process.execPath,
      [fileURLToPath(import.meta.url), "worker"],
      {
        cwd: root,
        detached: true,
        windowsHide: true,
        stdio: ["ignore", descriptor, descriptor],
        env: {
          ...process.env,
          MEDIAGO_SIGNPATH_QUEUE: queue,
          APP_NAME: "mediago",
          APP_TD_APPID: "",
          MEDIAGO_PROFILE: "production",
        },
      },
    );
    closeSync(descriptor);
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    await writeSigningRecord(path.join(queue, "worker.json"), {
      pid: child.pid,
      sourceSha: process.env.GITHUB_SHA,
    });
  } else if (operation === "worker") {
    const result = spawnSync("task", ["release:electron"], {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
    });
    await writeSigningRecord(path.join(queue, "completed.json"), {
      status: result.status,
      error: result.error?.message,
    });
    process.exitCode = result.status ?? 1;
  } else if (operation === "await") {
    const phase = phaseArgument();
    await waitForFile(
      path.join(queue, phase, "request.json"),
      30 * 60_000,
      path.join(queue, "completed.json"),
    );
    const request = JSON.parse(
      await fs.readFile(path.join(queue, phase, "request.json"), "utf8"),
    );
    if (
      request.sourceSha !== process.env.GITHUB_SHA ||
      request.version !== process.env.BUILD_VERSION ||
      request.phase !== phase
    ) {
      throw new Error(
        "Signing request source, version or phase does not match this job",
      );
    }
    const githubOutput = process.env.GITHUB_OUTPUT;
    if (!githubOutput)
      throw new Error("GitHub step output path is unavailable");
    await fs.appendFile(
      githubOutput,
      `version=${getSigningProductVersion(request.version, phase)}\n`,
    );
  } else if (operation === "complete") {
    const phase = phaseArgument();
    const directory = path.join(queue, phase);
    const unsigned = await fs.readFile(
      path.join(directory, "unsigned/mediago.exe"),
    );
    const signed = path.join(directory, "signed/mediago.exe");
    verifyTestSignature(signed);
    if (
      unsignedPeDigest(unsigned) !== unsignedPeDigest(await fs.readFile(signed))
    )
      throw new Error("Signed payload differs from the submitted file");
    await writeSigningRecord(path.join(directory, "ready.json"), { phase });
    await waitForFile(
      path.join(directory, "applied.json"),
      30 * 60_000,
      path.join(queue, "completed.json"),
    );
  } else if (operation === "finish") {
    const { parse } = await import("yaml");
    await waitForFile(path.join(queue, "completed.json"));
    const completion = JSON.parse(
      await fs.readFile(path.join(queue, "completed.json"), "utf8"),
    );
    if (completion.status !== 0)
      throw new Error("Packaging failed; see the signing build log");
    await Promise.all(
      SIGNING_PHASES.map((phase) =>
        waitForFile(path.join(queue, phase, "applied.json"), 1_000),
      ),
    );
    const version = process.env.BUILD_VERSION ?? "";
    const installer = `mediago-setup-win32-x64-${version}.exe`;
    const portable = `mediago-portable-win32-x64-${version}.exe`;
    for (const file of [installer, portable])
      verifyTestSignature(path.join(release, file));
    const metadata = parse(
      await fs.readFile(path.join(release, "test.yml"), "utf8"),
    ) as {
      version: string;
      path: string;
      sha512: string;
      files: { url: string; sha512: string; size: number }[];
    };
    const bytes = await fs.readFile(path.join(release, installer));
    const sha512 = createHash("sha512").update(bytes).digest("base64");
    const update = metadata.files.find((file) => file.url === installer);
    if (
      metadata.version !== version ||
      metadata.path !== installer ||
      metadata.sha512 !== sha512 ||
      update?.sha512 !== sha512 ||
      update?.size !== bytes.length
    ) {
      throw new Error(
        "Updater metadata does not match the final signed installer",
      );
    }
    await fs.writeFile(
      path.join(queue, "verification.json"),
      JSON.stringify(
        {
          version,
          sourceSha: process.env.GITHUB_SHA,
          certificateSha256: TEST_CERTIFICATE_SHA256,
          phases: SIGNING_PHASES,
          updaterSha512: sha512,
          productionTrusted: false,
        },
        null,
        2,
      ),
    );
  } else if (operation === "stop") {
    if (await fs.stat(path.join(queue, "completed.json")).catch(() => null))
      return;
    const worker = JSON.parse(
      await fs
        .readFile(path.join(queue, "worker.json"), "utf8")
        .catch(() => "{}"),
    );
    if (Number.isInteger(worker.pid) && worker.pid > 0)
      spawnSync("taskkill", ["/PID", String(worker.pid), "/T", "/F"], {
        windowsHide: true,
      });
  } else {
    throw new Error("Unknown Windows signing operation");
  }
}

await main();
