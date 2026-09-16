---
name: space-flow-review
description: Review a Space Flow code change for concrete regressions, ownership boundaries and sufficient tests before opening or updating a PR.
---

Compare the task branch to its current main baseline. Review changed code together with callers
and affected tests. Report specific findings with a triggering example and file/line evidence.
Separate observed defects from hypotheses and missing verification.

For API changes, verify input validation, auth/CSRF, user ownership, error behavior and conflict
handling. For file operations, test configured roots, traversal/symlinks and preservation of
unrelated files. For UI changes, inspect loading, error, empty and save states in the real browser.

Run existing focused checks; add a regression test when it captures the behavior that failed.
Do not count a mock, a source search or an AI report as a successful runtime test. Confirm the
tests and screenshots use isolated fixture data.

Compare the change with known related PRs: shared files, shared callers/contracts and duplicate
goals. A clean Git merge does not establish behavior compatibility. Request combined testing or
rebase-and-retest when another related change lands. Leave the final acceptance to the owner.
