param([Parameter(Mandatory=$true)][ValidateSet('install','remove')][string]$Operation)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:MEDIAGO_SIGNPATH_TEST -ne '1') {
  throw 'Test certificate trust is restricted to an ephemeral GitHub-hosted signing job.'
}
$certificatePath = Join-Path $PSScriptRoot '../../../../.task/signpath/test-certificate.cer'
if ($Operation -eq 'install') {
  $encoded = $env:SIGNPATH_TEST_CERTIFICATE_BASE64
  if ([string]::IsNullOrWhiteSpace($encoded) -or $encoded.Length -gt 65536) { throw 'Configure SIGNPATH_TEST_CERTIFICATE_BASE64 with the public test certificate.' }
  $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new([Convert]::FromBase64String($encoded))
} else {
  if (-not (Test-Path -LiteralPath $certificatePath -PathType Leaf)) { return }
  $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($certificatePath)
}
$fingerprint = $certificate.GetCertHashString([System.Security.Cryptography.HashAlgorithmName]::SHA256).ToLowerInvariant()
if ($fingerprint -ne '22d8e5b9d83f87a2145311bb517427fff528d2ce88a8bb4082491226ffb9c43a') {
  throw 'The test certificate fingerprint does not match.'
}
if ($Operation -eq 'install') {
  [System.IO.Directory]::CreateDirectory((Split-Path -Parent $certificatePath)) | Out-Null
  [System.IO.File]::WriteAllBytes($certificatePath,$certificate.RawData)
}
$store = [System.Security.Cryptography.X509Certificates.X509Store]::new('Root','CurrentUser')
try {
  $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
  if ($Operation -eq 'install') { $store.Add($certificate) } else { $store.Remove($certificate) }
} finally {
  $store.Close()
  $certificate.Dispose()
}
