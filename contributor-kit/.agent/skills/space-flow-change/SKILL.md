---
name: space-flow-change
description: Implement a feature or behavior change in the Space Flow contributor repository using its existing React, Express and node layers.
---

Read `docs/ARCHITECTURE.md` and the affected node's `node.json` or service before choosing an
implementation. Define one observable before/after example and the acceptance check.

Reuse existing components and services. Keep workflow data in the shared store; keep filesystem
and credentials outside browser code. Use `var(--text)`, `var(--card)`, `var(--card-border)` and
the existing neutral/accent tokens. Pair `--n900` with `--n0` so dark mode remains readable.

Inspect importers before changing a shared signature. Verify platform-sensitive paths on native
Windows and Linux where available; name the platform not exercised. Do not claim compatibility
from a build alone. For a new dependency, explain why and ask the owner to update the trusted
baseline; do not quietly remove the release policy check.

Run relevant tests, `npm run build` for UI changes, and inspect the actual screen. Write PR notes
with changed behavior, tests, limitations and other requests this change depends on or overlaps.
