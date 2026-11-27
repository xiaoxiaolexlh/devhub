# AI Working Rules

- Treat `D:\40\extension-sync` as the only writable workspace.
- Outside `D:\40\extension-sync`, only read/view operations are allowed.
- Do not create, modify, move, delete, format, install into, or run write-producing commands against paths outside this workspace.
- If a task genuinely requires write or execution permissions outside this workspace, ask the user for explicit permission before proceeding.
- Before packaging DevHub, check for any running `devhub.exe` process, including tray instances. If one is running, stop the packaging task and ask the user to exit DevHub. Resume only after verifying that the process has exited.
- Reuse existing directories whenever practical. Use the default output paths for DevHub builds where possible, and create extra directories only when the task requires them.
