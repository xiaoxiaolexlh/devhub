import type { EnvironmentVariable } from "@/lib/tauri";

export function isEditableEnvironmentVariable(variable: EnvironmentVariable) {
  return variable.value_type === 1 || variable.value_type === 2;
}

export function pathToLines(value: string) {
  return value.split(";").join("\n");
}

export function linesToPath(value: string) {
  // Preserve order, spaces, duplicates, empty entries and the trailing separator.
  return value.replace(/\r\n|\r|\n/g, ";");
}

export function validateEnvironmentVariable(variable: EnvironmentVariable): string | null {
  if (!variable.name.trim() || /[=\0]/.test(variable.name)) {
    return "变量名不能为空，且不能包含等号或空字符";
  }
  if (variable.name.length > 16_383) return "变量名过长，最多支持 16383 个 UTF-16 单元";
  if (variable.value.includes("\0")) return "变量值不能包含空字符";
  if (variable.value.length > 32_766) return "变量值过长，最多支持 32766 个 UTF-16 单元";
  if (!isEditableEnvironmentVariable(variable)) return "不支持修改此变量类型";
  return null;
}
