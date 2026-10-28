import fs from "node:fs";
import os from "node:os";
import { X509Certificate } from "node:crypto";
import path from "node:path";
import { CERTIFICATE_BASE64 } from "../../../../tests/fixtures/windows-signature-certificate";
import { describe, expect, test } from "vitest";
import {
  signatureCommand,
  validateSignatureEvidence,
  readSignatureEvidenceSync,
  assertWindowsUpdateSignature,
  verifyWindowsUpdateSignature,
  type SignatureEvidence,
} from "./windows-signature";

const certificate = new X509Certificate(
  Buffer.from(CERTIFICATE_BASE64, "base64"),
);
const subject = { CN: "MediaGo signature verification fixture" };
const file = path.resolve("installer.exe");
const evidence: SignatureEvidence = {
  status: "Valid",
  path: file,
  certificate: certificate.raw.toString("base64"),
  timestamp: true,
};

test("accepts a valid OS verdict only with the exact expected certificate identity", () => {
  expect(
    validateSignatureEvidence(
      evidence,
      file,
      subject,
      certificate.fingerprint256.replaceAll(":", ""),
    ).fingerprint256,
  ).toBe(certificate.fingerprint256);
});

test("the production update policy rejects a self-signed test identity", () => {
  expect(() => validateSignatureEvidence(evidence, file)).toThrow(
    "unexpected publisher",
  );
});

describe.each([
  "NotSigned",
  "HashMismatch",
  "NotTrusted",
  "UnknownError",
  undefined,
])("rejects OS status %s", (status) => {
  test("fails closed", () =>
    expect(() =>
      validateSignatureEvidence(
        { ...evidence, status: status as string },
        file,
        subject,
      ),
    ).toThrow());
});

test.each([
  { ...evidence, certificate: null },
  { ...evidence, certificate: "not a certificate" },
  { ...evidence, timestamp: false },
  { ...evidence, path: path.resolve("different-installer.exe") },
])("rejects missing or mismatched evidence", (invalid) => {
  expect(() => validateSignatureEvidence(invalid, file, subject)).toThrow();
});

test("rejects a different certificate even if the publisher name matches", () => {
  expect(() =>
    validateSignatureEvidence(evidence, file, subject, "0".repeat(64)),
  ).toThrow("fingerprint");
});

test("passes hostile filenames as environment data, never as PowerShell source", () => {
  const originalRoot = process.env.SystemRoot;
  process.env.SystemRoot = path.resolve("windows");
  try {
    const filename = path.resolve("quote' ; $(& injected) unicode-汉字.exe");
    const command = signatureCommand(filename);
    expect(command.args.join(" ")).not.toContain(filename);
    expect(command.options.env.MEDIAGO_SIGNATURE_FILE).toBe(filename);
    const source = Buffer.from(command.args.at(-1)!, "base64").toString(
      "utf16le",
    );
    expect(source).toContain("-LiteralPath $env:MEDIAGO_SIGNATURE_FILE");
    expect(command.options).not.toHaveProperty("shell");
  } finally {
    if (originalRoot === undefined) delete process.env.SystemRoot;
    else process.env.SystemRoot = originalRoot;
  }
});

test.runIf(process.platform === "win32")(
  "real PowerShell rejects an unsigned file with a hostile literal filename",
  async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "mediago-signature-test-"),
    );
    const filename = path.join(directory, "quote' ; $(& injected)-汉字.exe");
    try {
      fs.writeFileSync(filename, Buffer.from("unsigned test fixture"));
      expect(readSignatureEvidenceSync(filename).status).not.toBe("Valid");
      expect(() => assertWindowsUpdateSignature(filename)).toThrow();
      expect(await verifyWindowsUpdateSignature(filename)).not.toBeNull();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
  30_000,
);
