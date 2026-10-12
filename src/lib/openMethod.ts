import type { OpenMethod, Settings } from "@/lib/tauri";

export function isOpenMethodReady(method: OpenMethod | undefined | null): boolean {
  if (!method || !method.enabled) return false;
  if (method.kind === "external_app" && !method.command.trim()) return false;
  return true;
}

export function openMethodUnavailableReason(
  method: OpenMethod | undefined | null,
): string | null {
  if (!method) return "打开方式不存在";
  if (!method.enabled) return "已在设置中禁用";
  if (method.kind === "external_app" && !method.command.trim()) {
    return "请先在设置中配置可执行文件路径";
  }
  return null;
}

/** Enabled methods in settings order (shown in the open menu). */
export function enabledOpenMethods(settings: Settings | null | undefined): OpenMethod[] {
  return settings?.open_methods?.filter((m) => m.enabled) ?? [];
}

/** Preferred method for the main button: default if ready, else first ready. */
export function resolvePrimaryOpenMethod(
  settings: Settings | null | undefined,
): OpenMethod | null {
  const methods = enabledOpenMethods(settings);
  if (methods.length === 0) return null;
  const preferredId = settings?.default_open_method_id;
  const preferred = methods.find((m) => m.id === preferredId);
  if (isOpenMethodReady(preferred)) return preferred ?? null;
  return methods.find((m) => isOpenMethodReady(m)) ?? null;
}
