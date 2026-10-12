import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

export interface UpdateCheckResult {
  available: boolean;
  currentVersion: string;
  newVersion: string | null;
  body: string | null;
}

let pendingUpdate: Update | null = null;

export async function getCurrentVersion(): Promise<string> {
  return getVersion();
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = await getVersion();
  pendingUpdate = await check();
  if (pendingUpdate) {
    return {
      available: true,
      currentVersion,
      newVersion: pendingUpdate.version,
      body: pendingUpdate.body ?? null,
    };
  }
  pendingUpdate = null;
  return {
    available: false,
    currentVersion,
    newVersion: null,
    body: null,
  };
}

export async function downloadAndInstallUpdate(
  onProgress?: (downloaded: number, total: number) => void,
): Promise<void> {
  if (!pendingUpdate) throw new Error("没有待安装的更新，请先检查更新");
  let total = 0;
  let downloaded = 0;
  await pendingUpdate.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data?.contentLength ?? 0;
        break;
      case "Progress":
        downloaded += event.data?.chunkLength ?? 0;
        if (onProgress && total > 0) {
          onProgress(downloaded, total);
        }
        break;
      case "Finished":
        break;
    }
  });
  pendingUpdate = null;
  await relaunch();
}
