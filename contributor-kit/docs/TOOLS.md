# Contributor working kit

Run application setup separately from optional analysis tooling:

```bash
npm run setup
npm run tools:setup
npm run tools:doctor
npm run graph -- build
scripts/bin/harness-cli query matrix
```

Requirements: Node.js 24.16+, Git, Python 3.10+ with the `venv` module (Debian/Ubuntu package:
`python3-venv`). Use Git Bash on Windows.
`SF_TOOLS_PYTHON` may point to a Python executable. Tools are installed only in this checkout.
Setup pins Harness 0.1.22 with platform SHA-256 verification and code-review-graph 2.3.8 in a
Python virtual environment. Python transitive dependencies resolve through pip. No global
agent settings, model preference or paid embedding provider is changed. Installation needs
GitHub/PyPI network access; an offline failure is reported and can be retried.

Harness supports Windows x64, Linux x64/arm64 and macOS x64/arm64 in this installer.
The pinned Linux binary requires glibc 2.39+ (for example Ubuntu 24.04); it does not run on
Debian Bookworm or Alpine. This is a contributor workstation tool, separate from the application
runtime image. Setup reports this requirement before attempting installation on an older libc.
Do not copy a virtual environment or executable between operating systems; rerun setup.

## Codegraph

```bash
npm run graph -- build
npm run graph -- update
npm run graph -- status
npm run graph -- impact --help
npm run graph -- query --help
```

Build before the first query; update after source changes. The graph is an aid for locating
callers, imports and tests. Dynamic registration, HTTP calls and cross-language contracts need
source inspection and actual tests. Indexing is local, with embeddings disabled by default.

For an MCP client, use a repository-scoped stdio server: command `node`, arguments
`["/absolute/path/to/checkout/scripts/contributor-tools.cjs", "graph", "serve", "--repo", "/absolute/path/to/checkout"]`.
Replace the path for this machine. Setup does not edit your personal Codex/Claude MCP settings.

## What is shared

Five curated skills cover scoped changes, debugging, review, impact analysis and Harness.
Their canonical copies live in `.agent/skills`; identical copies are exported into
`.agents/skills` for Codex and `.claude/skills` for Claude. Change the canonical kit in the
owner baseline, then re-export to keep them synchronized.

Included: contributor-specific AGENTS/CLAUDE, project rules, architecture, tool instructions,
PR template, change-note template and the pinned installer. Excluded: owner session history,
private specs/issues, personal settings/hooks, agent accounts, secrets, production commands,
Harness database and graph index. `contributor-toolkit.json` lists every exported kit file hash.

Sources: [Codex skill discovery](https://developers.openai.com/codex/skills),
[Codegraph upstream](https://github.com/tirth8205/code-review-graph),
[Harness pinned release](https://github.com/hoangnb24/repository-harness/releases/tag/harness-cli-v0.1.22).
