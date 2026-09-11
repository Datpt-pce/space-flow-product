# UI contribution rules

Extend the existing screen and component patterns before introducing a new pattern. Read nearby
code and the theme tokens in the frontend. Use semantic tokens such as `--text`, `--sub`,
`--card`, `--card-border`, `--canvas`, `--accent` and status colors; verify they exist in the
current theme. Do not add a separate color system or hardcode a light-only background.

For node UI, preserve port IDs, saved config keys and backward compatibility. Workflow state
belongs in the existing store; local component state is appropriate for transient forms/dialogs.
Keep API/permission enforcement server-side even when a button is hidden or disabled.

Show real loading, empty, error and successful states. Disable duplicate submissions while a
request is pending, preserve drafts when refreshes arrive, and check revisions before overwrites.
Label inputs and icon-only buttons; use keyboard focus and semantic buttons/dialogs.

Verify the changed flow in an actual browser: perform the action, reload to check persistence,
inspect a screenshot, then fix layout issues. Check light/dark and a narrow viewport; watch for
horizontal overflow, clipped actions and unreadable labels. Put the relevant evidence and any
remaining limitation in the PR. A build passing alone is not UI acceptance.
