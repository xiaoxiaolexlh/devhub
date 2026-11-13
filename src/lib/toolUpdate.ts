import type { ToolListItem, ToolProcessInfo } from "./tauri";

interface UpdateApi {
  toolRunningProcesses(toolId: string): Promise<ToolProcessInfo[]>;
  toolUpdate(toolId: string, closeRunning: boolean): Promise<ToolListItem>;
}

export async function updateToolSafely(
  toolId: string,
  api: UpdateApi,
  confirmClose: () => Promise<boolean>,
): Promise<ToolListItem | null> {
  const processes = await api.toolRunningProcesses(toolId);
  const closeRunning = processes.length > 0;
  if (closeRunning && !(await confirmClose())) return null;
  try {
    return await api.toolUpdate(toolId, closeRunning);
  } catch (error) {
    // A tool may start between the preflight check and file replacement.
    // The backend refuses replacement; request consent before retrying.
    if (
      !closeRunning &&
      typeof error === "object" && error !== null &&
      "kind" in error && error.kind === "running"
    ) {
      if (!(await confirmClose())) return null;
      return api.toolUpdate(toolId, true);
    }
    throw error;
  }
}
