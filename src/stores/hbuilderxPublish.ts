import { create } from "zustand";
import type { HBuilderXPublishResult } from "@/lib/tauri";

export type HBuilderXPublishPlatform =
  | "cloud-app"
  | "local-app-resource"
  | "mp-alipay";

interface PublishTask {
  projectId: string;
  platform: HBuilderXPublishPlatform;
  running: boolean;
  result?: HBuilderXPublishResult;
}

interface HBuilderXPublishState {
  tasks: Record<string, PublishTask>;
  latestTask: Pick<PublishTask, "projectId" | "platform"> | null;
  runPublish: (
    projectId: string,
    platform: HBuilderXPublishPlatform,
    execute: () => Promise<HBuilderXPublishResult>,
  ) => Promise<HBuilderXPublishResult | null>;
}

export function publishTaskKey(projectId: string, platform: HBuilderXPublishPlatform) {
  return JSON.stringify([projectId, platform]);
}

// Keep pending invocations and completed output when the CLI page unmounts.
export const useHBuilderXPublish = create<HBuilderXPublishState>((set, get) => ({
  tasks: {},
  latestTask: null,

  async runPublish(projectId, platform, execute) {
    // Check synchronously as well as disabling buttons: rapid clicks must not
    // submit another build against the same project's output directories.
    if (Object.values(get().tasks).some((task) => task.projectId === projectId && task.running)) {
      return null;
    }

    const key = publishTaskKey(projectId, platform);
    set((state) => ({
      latestTask: { projectId, platform },
      tasks: { ...state.tasks, [key]: { projectId, platform, running: true } },
    }));

    let result: HBuilderXPublishResult;
    try {
      result = await execute();
    } catch (error) {
      result = {
        success: false,
        command_success: false,
        exit_code: null,
        stdout: "",
        stderr: "",
        command: "",
        error: String(error),
        copy_result: null,
      };
    }

    set((state) => ({
      tasks: { ...state.tasks, [key]: { projectId, platform, running: false, result } },
    }));
    return result;
  },
}));
