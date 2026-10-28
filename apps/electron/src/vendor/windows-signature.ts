import { execFile, execFileSync } from "node:child_process";
import { X509Certificate } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

export const SIGNPATH_PUBLISHER = {
  CN: "SignPath Foundation",
  O: "SignPath Foundation",
  C: "US",
  ST: "DE",
  L: "Lewes",
} as const;

export const SIGNPATH_PUBLISHER_DN =
  "CN=SignPath Foundation, O=SignPath Foundation, L=Lewes, S=DE, C=US";

export interface SignatureEvidence {
  status: string;
  path: string;
  certificate: string | null;
  timestamp: boolean;
}

const SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$signature = Get-AuthenticodeSignature -LiteralPath $env:MEDIAGO_SIGNATURE_FILE
$certificate = $null
if ($signature.SignerCertificate) {
  $certificate = [Convert]::ToBase64String($signature.SignerCertificate.RawData)
}
[pscustomobject]@{
  status = $signature.Status.ToString()
  path = $signature.Path
  certificate = $certificate
  timestamp = ($null -ne $signature.TimeStamperCertificate)
} | ConvertTo-Json -Compress
`;

export function signatureCommand(file: string) {
  if (!path.isAbsolute(file) || !file.toLowerCase().endsWith(".exe")) {
    throw new Error("An absolute Windows executable path is required");
  }
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !path.isAbsolute(systemRoot)) {
    throw new Error("Windows SystemRoot is unavailable");
  }
  return {
    executable: path.join(
      systemRoot,
      "System32/WindowsPowerShell/v1.0/powershell.exe",
    ),
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(SCRIPT, "utf16le").toString("base64"),
    ],
    options: {
      encoding: "utf8" as const,
      timeout: 20_000,
      windowsHide: true,
      maxBuffer: 256 * 1024,
      env: {
        ...process.env,
        PSModulePath: path.join(
          systemRoot,
          "System32/WindowsPowerShell/v1.0/Modules",
        ),
        MEDIAGO_SIGNATURE_FILE: file,
      },
    },
  };
}

export function validateSignatureEvidence(
  evidence: SignatureEvidence,
  file: string,
  expectedSubject: Readonly<Record<string, string>> = SIGNPATH_PUBLISHER,
  fingerprint?: string,
): X509Certificate {
  if (
    evidence.status !== "Valid" ||
    typeof evidence.path !== "string" ||
    path.resolve(evidence.path).toLowerCase() !==
      path.resolve(file).toLowerCase() ||
    typeof evidence.certificate !== "string" ||
    !evidence.timestamp
  ) {
    throw new Error("The Windows signature, file path or timestamp is invalid");
  }
  const certificate = new X509Certificate(
    Buffer.from(evidence.certificate, "base64"),
  );
  const subject = Object.fromEntries(
    certificate.subject.split("\n").map((entry) => {
      const separator = entry.indexOf("=");
      return [entry.slice(0, separator), entry.slice(separator + 1)];
    }),
  );
  if (
    Object.keys(subject).length !== Object.keys(expectedSubject).length ||
    Object.entries(expectedSubject).some(
      ([key, value]) => subject[key] !== value,
    )
  ) {
    throw new Error("The Windows installer has an unexpected publisher");
  }
  if (
    fingerprint &&
    certificate.fingerprint256.replace(/:/g, "").toLowerCase() !==
      fingerprint.toLowerCase()
  ) {
    throw new Error(
      "The Windows signing certificate fingerprint does not match",
    );
  }
  return certificate;
}

export function readSignatureEvidenceSync(file: string): SignatureEvidence {
  const command = signatureCommand(file);
  return JSON.parse(
    execFileSync(command.executable, command.args, command.options).replace(
      /^\uFEFF/,
      "",
    ),
  ) as SignatureEvidence;
}

export function assertWindowsUpdateSignature(file: string): void {
  validateSignatureEvidence(readSignatureEvidenceSync(file), file);
}

export async function verifyWindowsUpdateSignature(
  file: string,
): Promise<string | null> {
  try {
    const command = signatureCommand(file);
    const result = await promisify(execFile)(
      command.executable,
      command.args,
      command.options,
    );
    validateSignatureEvidence(
      JSON.parse(result.stdout.replace(/^\uFEFF/, "")) as SignatureEvidence,
      file,
    );
    return null;
  } catch {
    return "Windows publisher signature verification failed";
  }
}
