# Space Flow contributor instructions

Read `CONTRIBUTING.md`, `CLAUDE.md`, `.claude/rules/project.md` and `docs/ARCHITECTURE.md`
before implementation. Use a Bash-compatible terminal, including Git Bash on Windows.

For nontrivial work, read `docs/HARNESS.md`, run `npm run tools:doctor` and
`scripts/bin/harness-cli query matrix`. Query equipped tools before using them. A missing tool
is a visible setup issue; do not invent results. Never copy a colleague's local database or tokens.

Read `.agent/README.md` to choose only the skill needed for the current task. Codex discovers
the same curated skills under `.agents/skills`; Claude discovers them under `.claude/skills`.
Do not bulk-read all skills or all source. User instructions define scope and authorized actions.

Use a task branch. Include goal, affected areas, test evidence and related PRs in the pull request.
Rebase onto the current baseline after another contribution lands and repeat affected tests.
Owner acceptance and release are separate decisions; a contributor never deploys the team server.
