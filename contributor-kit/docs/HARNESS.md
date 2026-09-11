# Harness on a contributor machine

Run `npm run tools:setup`, then `npm run tools:doctor`. The setup downloads the pinned Rust CLI
for your OS and checks its expected SHA-256 before installation. It creates a new local database.
No Rust compiler is required. Codegraph uses a separate Python virtual environment.

```bash
scripts/bin/harness-cli query matrix
scripts/bin/harness-cli intake --type change-request --summary 'Fix Text empty output' --lane normal
scripts/bin/harness-cli story add --id TEXT-01 --title 'Text handles empty input' --lane normal
scripts/bin/harness-cli story update --id TEXT-01 --status in_progress
scripts/bin/harness-cli query tools --capability impact-analysis --status present
# Run the actual tests; then record only the proof you have:
scripts/bin/harness-cli story update --id TEXT-01 --unit 1 --integration 0 --e2e 0 --platform 0 --evidence docs/changes/text-empty.md
scripts/bin/harness-cli story update --id TEXT-01 --status implemented
```

Use `--help` for additional commands. On Windows, Git Bash also resolves the installed
`harness-cli.exe`. State stays in `harness.db`; do not commit it, its WAL/SHM, local graph indexes
or generated caches. Share the sanitized change note and actual test output in the PR.

Risk lane: ordinary copy/naming is tiny; bounded behavior is normal; auth/permissions, data loss,
schema changes or external effects are high-risk. A high-risk change needs a clear design and
failure-path checks before implementation. If the requested direction is unclear, clarify it.
