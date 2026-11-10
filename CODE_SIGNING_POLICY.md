# ORBIT Code Signing Policy

**Status:** ORBIT intends to apply to the SignPath Foundation open-source code-signing program. The application has not been approved, and current Windows installers remain unsigned. Do not assume that a download is signed until its Windows file properties show a valid Authenticode signature.

**Free code signing provided by SignPath.io, certificate by SignPath Foundation.** This statement describes the intended program attribution and does not mean that signing is already active.

## Scope of signing

If accepted, ORBIT will submit only the ORBIT Windows application executable and Windows installer that are built from this repository's source code by the repository's official GitHub Actions release workflow. Signing requests will be tied to version tags and verified build origin. Every release signing request will require manual approval by an authorized approver.

Third-party applications, services, libraries, media, and other upstream software are not ORBIT projects and will not be re-signed using an ORBIT signing subscription. Their own signatures, if any, remain unchanged.

## Team roles

The current project is maintained through the `Nin01234` GitHub account:

- **Authors / committers:** [Nin01234](https://github.com/Nin01234) — may make changes to the ORBIT source repository.
- **Reviewers:** [Nin01234](https://github.com/Nin01234) — reviews external contributions before they are merged.
- **Approvers:** [Nin01234](https://github.com/Nin01234) — checks the tagged source, release build, and requested artifact before approving each signing request.

If additional maintainers are added, their roles will be documented here. Every person with source-write, review, or signing-approval access must have multi-factor authentication enabled on GitHub and SignPath before receiving that access. External contributions must be reviewed before merge. No release is signed without manual approval.

## Build and release integrity

Official Windows releases are intended to be built by GitHub Actions from tagged commits in this repository. Build scripts and workflow changes are part of the reviewed source. Local developer-machine builds are not eligible for SignPath origin verification. Release artifacts will be checked for the expected ORBIT product name and version before publication.

## Privacy

See [ORBIT Privacy Notice](PRIVACY.md) for local storage, Spotify authorization, and third-party network services used by the application. ORBIT does not claim that third-party providers are covered by this policy; their own privacy policies apply when users use those services.

## Verify a signed download

Once signing is approved and enabled, users can verify a Windows installer by opening **Properties → Digital Signatures** in Windows and checking that the signature is valid and the signer is the expected SignPath Foundation certificate. Until then, ORBIT releases remain unsigned.

## Reporting concerns

Report a suspected signing or release-integrity issue through [ORBIT Desktop GitHub Issues](https://github.com/Nin01234/ORBIT-Desktop/issues).
