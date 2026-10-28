# Windows test signing

MediaGo has been accepted into the SignPath Foundation program. Production
certificate issuance follows SignPath's review of the technical integration.
This workflow only uses `test-signing`; it never publishes a Release, moves a
tag, modifies the stable update channel, or uses `release-signing`.

## Maintainer setup

1. Accept the MediaGo OSS organization invitation and confirm the **CI builds**
   notification email address, in that order. All signing users must use MFA.
2. In the `mediago` SignPath project's **Artifact Configurations**, add a new
   configuration with slug **mediago-windows-test** and import
   [windows-test.xml](windows-test.xml). Keep the existing production policy and
   default configuration unchanged. This configuration accepts a ZIP containing
   one `mediago.exe`, requires the product name `mediago`, and binds its product
   product version to the required `version` request parameter for each phase. It does not recursively
   sign other executables or third-party tools.
   Leave signature description fields unset: the Foundation plan supplies its
   own mandatory signature watermark and rejects custom descriptions.
3. In **Users and Groups → CI builds**, obtain a CI submitter API token and put
   it directly in the repository's GitHub Actions Secret **SIGNPATH_API_TOKEN**.
   Do not paste it in issues, PRs, chat, workflow inputs, or repository files.
   Use a test-only submitter where available; production approval must remain
   with a human maintainer.
4. Confirm the project is linked to **GitHub.com** as a trusted build system.
   Check the SignPath GitHub App repository authorization if requested by the
   connector. A maintainer must approve any new application permissions.
5. Download the **public test certificate** from SignPath. Encode the complete
   PEM or DER file as Base64 and store it in the GitHub Actions Secret
   **SIGNPATH_TEST_CERTIFICATE_BASE64**. For example, run this locally and paste
   the clipboard contents directly into GitHub, never into a chat or PR:

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\path\test_certificate_2026.pem')) | Set-Clipboard
   ```

   Verify the certificate matches the pinned identity:
   `22D8E5B9D83F87A2145311BB517427FFF528D2CE88A8BB4082491226FFB9C43A` (SHA-256).
   No real certificate or private key is stored in the repository. Certificate
   rotation requires review of the pinned fingerprint and configuration together.

## Run and review

Run **Windows SignPath test signing** from GitHub Actions. Its initial integration
branch also triggers the workflow so the first PR can be tested before merging.
The displayed version and artifact filenames keep `3.6.0-test.N`; the Windows
numeric product version uses `3.6.0.N`, while NSIS executables retain the
`3.6.0-test.N` ProductVersion string. Each signing phase submits its exact expected
representation. The test build number is
explicit and every numeric component is restricted to 0-65535.

Only GitHub-hosted Windows runners are supported. The source and fixed test
policy are recorded on every request; unsigned inputs must first be stored as
GitHub workflow artifacts so SignPath can verify their origin.

The packager pauses at four signing checkpoints: the MediaGo application,
uninstaller, NSIS installer, and portable launcher. Each checkpoint submits a
ZIP to the official, commit-pinned SignPath Action. The returned executable must
have the pinned test signature, a valid Windows verdict and timestamp, and the
same PE payload as the unsigned input. Packaging resumes only after these
checks. Updater SHA-512, size and blockmaps are consequently generated after
signing, and the final `test.yml` is checked against the signed installer.

The self-signed certificate is trusted **only in the disposable hosted signing
runner LocalMachine Root store**, after checking its SHA-256 fingerprint. The
CurrentUser Root store requires an interactive Windows prompt and is unsuitable
for unattended CI. Both trust operations have a two-minute timeout. An unconditional cleanup step
removes that trust. Neither MediaGo nor its installer imports test certificates
into users' trust stores. Test builds disable automatic updates and installation
of updates; their manual update action opens the public Releases page.

Download the `mediago-test-signed-windows-*` artifact to inspect the test-signed
preview and verification record. This certificate is not publicly trusted by
Windows. Never describe it as a production signature or distribute it through
the stable/beta update feeds. If a checkpoint fails, inspect
`signpath-diagnostics-*`; no unsigned fallback is published.

Official Windows release builds (`RUN_MODE=release`) verify the packaged application,
installer, and portable launcher with the production signature policy before the
workflow can upload them. Until production signing is integrated, unsigned release
builds fail closed. Test builds and unpacked development builds keep their existing
behavior; do not disable this gate to publish unsigned updates.

## Before production signing

Send SignPath the successful workflow and request links for their review, then
wait for them to issue/import the production certificate. Verify the issued
certificate's **complete subject**, chain and timestamp before adjusting the
production publisher policy. The currently configured full publisher DN is the
pending certificate request identity, not evidence that a production certificate
has already been issued. Production signing/release automation is intentionally
outside this test integration and still requires human approval and a separate
verified change.

Windows update downloads (including cached downloads) are verified before they
are announced as ready. Both explicit installation and installation on quit
verify the current installer again, fail closed on PowerShell errors, and require
a trusted, timestamped signature from the complete expected production identity.
Missing `publisherName` metadata cannot disable these checks. Self-signed test
certificates are never accepted by the production update policy.

An old unsigned client cannot acquire these protections retroactively. Document
manual installation of the first publicly trusted signed release. Update the
public code signing policy and identify that first release only after actual
production verification.

References: [GitHub integration](https://docs.signpath.io/trusted-build-systems/github),
[artifact configurations](https://docs.signpath.io/artifact-configuration/),
[Foundation conditions](https://signpath.org/terms).
