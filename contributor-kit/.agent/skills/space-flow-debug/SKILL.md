---
name: space-flow-debug
description: Reproduce and fix a Space Flow bug with evidence, including state, ownership, browser and Windows/Linux differences.
---

Reproduce the reported behavior using a small fixture and record expected versus actual output.
Identify the failing layer before editing: browser/store, HTTP/auth, service/DB, executor or agent.
Check the calling code and recent relevant changes. Avoid reading unrelated logs or user data.

Use targeted `rg` searches; for multiple callers, use `npm run graph -- update` and the graph's
review-context tools when available. Verify the graph reflects the current checkout.

Fix the demonstrated cause, then repeat the original reproduction and affected regressions.
Check empty input, reload, another user and OS-specific behavior where relevant. If the issue
needs a real external provider, state what the local fixture proves and what it does not.

Keep a short root-cause and validation note in `docs/changes/`. Do not add automatic retries to
operations that may already have produced an external effect; inspect the receipt first.
