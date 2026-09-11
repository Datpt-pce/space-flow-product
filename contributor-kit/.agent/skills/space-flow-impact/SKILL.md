---
name: space-flow-impact
description: Use the local code-review-graph to find callers, shared dependencies and affected tests for a multi-file Space Flow change.
---

Run `npm run tools:doctor`. If the graph tool is missing, install the repository's pinned tooling
with `npm run tools:setup`; report an installation failure and use targeted `rg` as a fallback.

Run `npm run graph -- build` for the first index, then `npm run graph -- update` after source
changes. Use `npm run graph -- --help` for supported CLI queries. When using an MCP client,
register the local command described in `docs/TOOLS.md`, scoped to this repository.

Trace changed functions/files to callers, imports and tests. Read the relevant source to verify
the graph's suggestions. Explicitly check dynamic node registration, HTTP endpoints, database
contracts and Python/JavaScript crossings, which static edges may miss.

Record affected files/areas and relevant test commands in the PR. Do not describe zero graph
matches as proof of independence. Keep `.code-review-graph/` local; rebuild on each contributor
machine and never import the owner's index or register the owner's private repository.
