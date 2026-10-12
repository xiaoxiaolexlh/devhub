const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  rs: "rust",
  md: "markdown",
  markdown: "markdown",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  py: "python",
  go: "go",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  rb: "ruby",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ps1: "powershell",
  sql: "sql",
  vue: "html",
  svelte: "html",
};

export function workspaceRootFromUrl(search = window.location.search): string | null {
  const value = new URLSearchParams(search).get("workspace");
  return value || null;
}

export function workspaceFileFromUrl(search = window.location.search): string | null {
  const value = new URLSearchParams(search).get("file");
  return value || null;
}

export function workspaceSingleFileFromUrl(search = window.location.search): boolean {
  const value = new URLSearchParams(search).get("singleFile");
  return value === "1" || value === "true";
}

export function languageForPath(path: string): string {
  const clean = path.split(/[\\/]/).pop() ?? path;
  const dot = clean.lastIndexOf(".");
  if (dot < 0 || dot === clean.length - 1) return "plaintext";
  const extension = clean.slice(dot + 1).toLowerCase();
  return LANGUAGE_BY_EXTENSION[extension] ?? "plaintext";
}

export function displayPath(path: string): string {
  return path.replace(/\\/g, "/");
}

export function baseName(path: string): string {
  const parts = displayPath(path).split("/").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}
