---
name: space-flow-harness
description: Track a Space Flow contributor task and its verification evidence in the local Rust Harness CLI without sharing private runtime records.
---

Read `docs/HARNESS.md`. Use the installed `scripts/bin/harness-cli` as the operational interface.
Run `--help` for command syntax and `query matrix` to inspect existing local work.

Record intake before implementation. Use a story for a bounded behavior change; use the
high-risk lane when permissions, data loss, external effects or multiple domains are involved.
Update evidence after running the actual checks, using numeric proof flags (`1` or `0`).

Use `query tools --capability impact-analysis --status present` to discover equipped tooling.
Tool presence means installed, not proof that an index is fresh or a test passed.

Keep `harness.db` and its journals local. Share a short sanitized `docs/changes/` note containing
the goal, affected areas, evidence and outstanding issues. Do not copy the owner's history or
mark a story complete because code was written without verification.
