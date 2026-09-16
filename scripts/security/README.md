# Backend dependency maintenance

`Dockerfile.backend` keeps Node 24.21.0 and uses Wolfi's glibc runtime,
Python 3.12 and FFmpeg 9.0.1. Build stages do not ship compilers. Image IDs,
package inventories and scan results are recorded by `scripts/release-evidence.js`.

## Scanners

Syft 1.51.1 and Grype 0.118.0 source archives are SHA256 pinned. They are built
with Go 1.26.7, gRPC 1.83.2 and x/crypto 0.56.0. The Grype completion patch
uses the Moby client already in its dependency graph, removing the obsolete
Docker module from the linked binary. Tests cover tagged-image filtering,
prefix matching and completion fallback when Docker is unavailable.

These are local maintenance builds (`-sf.1`), not newer upstream releases.
Keep registry SBOM/vulnerability scanning enabled.

## Media

PyAV 18.1.0 is built against FFmpeg 9 rather than downloading a wheel with
older bundled FFmpeg libraries. FFmpeg is rebuilt with libass so subtitle
rendering remains available. Runtime media tests cover subtitle/drawtext,
H264/AAC, video/audio decode, AVIF, SVG fonts and GIF optimization.

## Temporary zlib backport

The distribution scanner advertises zlib 1.3.3 as fixing CVE-2026-85091,
but neither the upstream release nor the distribution package was available
when checked on 2026-09-17. Do not label 1.3.2 as an upstream 1.3.3 release.

`zlib-stall.patch` adapts the still-open
[upstream proposal 1317](https://github.com/madler/zlib/pull/1317)
at commit `0525e07f6f2c23f9b0e2e04387f847b4c7006a3f` to release 1.3.2.
The adaptation removes the extra null-pointer context line present only on
upstream develop; the proposed bounds checks and regression are retained.
This is a locally maintained backport, not an upstream-approved release.

`build-zlib.sh` requires all of these before producing the library:

1. The original implementation, with the new regression, must fail under
   ASan with a heap-buffer-overflow.
2. The patched implementation must pass the ASan/UBSan suite.
3. The normal static/shared/64-bit suites must pass.

Non-PIE sanitizer executables avoid intermittent ASan shadow-memory startup
failures in Docker Desktop. Every test has a timeout and forced termination.

The runtime package version remains `1.3.2-r7`; its shared library is replaced
with the tested build. `zlib-fixed.json` pins the reviewed library SHA256.
The release gate first retains the raw scan, then checks that exact library
hash, the actual loader symlink, and the dynamically linked regression in the
immutable candidate. Only then does it generate an OpenVEX `fixed` statement
for this one CVE. The VEX and raw report remain part of the evidence. Changed
bytes, inventory, image identity or failed regression block the attestation.
All other High/Critical findings still fail the unchanged severity threshold.

Replace this backport with a verified vendor release when available, remove
the temporary VEX path, then repeat the image scan and media regression.
The current reviewed binary hash covers Linux amd64; another architecture
requires its own build, regression and reviewed hash.

## Validation commands

```bash
node --test tests/lib/release-evidence.test.js tests/lib/release-vex.test.js
docker build -f Dockerfile.backend -t space-flow-readiness-backend:local .
node scripts/release-evidence.js
```

Run `tests/platform/backend-media-smoke.py` inside the candidate as its
ordinary non-root user. `tests/platform/speech-security-smoke.py` checks the
new optional speech dependencies on CPU with real, small model classes.
Neither test claims production model quality or a native GPU/Windows pilot.
