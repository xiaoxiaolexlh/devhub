# AI Working Rules

- Treat `D:\40\extension-sync` as the only writable workspace.
- Outside `D:\40\extension-sync`, only read/view operations are allowed.
- Do not create, modify, move, delete, format, install into, or run write-producing commands against paths outside this workspace.
- If a task genuinely requires write or execution permissions outside this workspace, ask the user for explicit permission before proceeding.
