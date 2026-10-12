import { useCallback, useEffect, useMemo, useState } from "react";
import MonacoEditor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker.js?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker.js?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker.js?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker.js?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker.js?worker";
import "monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js";
import "monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution.js";
import "monaco-editor/esm/vs/basic-languages/css/css.contribution.js";
import "monaco-editor/esm/vs/basic-languages/go/go.contribution.js";
import "monaco-editor/esm/vs/basic-languages/html/html.contribution.js";
import "monaco-editor/esm/vs/basic-languages/ini/ini.contribution.js";
import "monaco-editor/esm/vs/basic-languages/java/java.contribution.js";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js";
import "monaco-editor/esm/vs/basic-languages/less/less.contribution.js";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js";
import "monaco-editor/esm/vs/basic-languages/php/php.contribution.js";
import "monaco-editor/esm/vs/basic-languages/powershell/powershell.contribution.js";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution.js";
import "monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution.js";
import "monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js";
import "monaco-editor/esm/vs/basic-languages/scss/scss.contribution.js";
import "monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js";
import "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js";
import "monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js";
import "monaco-editor/esm/vs/language/css/monaco.contribution.js";
import "monaco-editor/esm/vs/language/html/monaco.contribution.js";
import "monaco-editor/esm/vs/language/json/monaco.contribution.js";
import "monaco-editor/esm/vs/language/typescript/monaco.contribution.js";
import { AlertTriangle, ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Loader2, RefreshCcw, Save } from "lucide-react";
import { OpenWithButton } from "@/components/OpenWithButton";
import { Button } from "@/components/ui/Button";
import { tauri, type WorkspaceEntry } from "@/lib/tauri";
import { baseName, displayPath, languageForPath } from "@/lib/workspace";

const monacoGlobal = globalThis as typeof globalThis & {
  MonacoEnvironment?: {
    getWorker: (_moduleId: string, label: string) => Worker;
  };
};

monacoGlobal.MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    if (label === "json") return new JsonWorker();
    if (label === "css" || label === "scss" || label === "less") {
      return new CssWorker();
    }
    if (label === "html" || label === "handlebars" || label === "razor") {
      return new HtmlWorker();
    }
    if (label === "typescript" || label === "javascript") {
      return new TsWorker();
    }
    return new EditorWorker();
  },
};

loader.config({ monaco });

interface WorkspacePageProps {
  root: string;
  initialFile?: string | null;
  singleFile?: boolean;
}

interface TreeNodeProps {
  root: string;
  entry: WorkspaceEntry;
  depth: number;
  selectedPath: string | null;
  onOpenFile: (relativePath: string) => void;
}

export function WorkspacePage({ root, initialFile, singleFile = false }: WorkspacePageProps) {
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [initialOpened, setInitialOpened] = useState(false);

  const dirty = currentPath !== null && fileError === null && content !== savedContent;
  const language = useMemo(
    () => (currentPath ? languageForPath(currentPath) : "plaintext"),
    [currentPath],
  );
  const editorTheme = document.documentElement.classList.contains("dark")
    ? "vs-dark"
    : "light";

  const saveFile = useCallback(async () => {
    if (!currentPath || fileError || saving || !dirty) return;
    setSaving(true);
    setSaveError(null);
    try {
      await tauri.writeWorkspaceFile(root, currentPath, content);
      setSavedContent(content);
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }, [content, currentPath, dirty, fileError, root, saving]);

  const loadRoot = useCallback(async () => {
    setTreeLoading(true);
    setTreeError(null);
    try {
      const next = await tauri.readWorkspaceDir(root, "");
      setEntries(next);
    } catch (e) {
      setEntries([]);
      setTreeError(String(e));
    } finally {
      setTreeLoading(false);
    }
  }, [root]);

  const openFile = useCallback(async (relativePath: string) => {
    if (
      currentPath &&
      currentPath !== relativePath &&
      dirty &&
      !window.confirm("当前文件有未保存修改，确定要放弃并打开其它文件吗？")
    ) {
      return;
    }
    setCurrentPath(relativePath);
    setContent("");
    setSavedContent("");
    setFileError(null);
    setSaveError(null);
    setFileLoading(true);
    try {
      const file = await tauri.readWorkspaceFile(root, relativePath);
      setCurrentPath(file.relative_path);
      setContent(file.content);
      setSavedContent(file.content);
    } catch (e) {
      setFileError(String(e));
    } finally {
      setFileLoading(false);
    }
  }, [currentPath, dirty, root]);

  useEffect(() => {
    if (singleFile) return;
    void loadRoot();
  }, [loadRoot, singleFile]);

  useEffect(() => {
    if (!initialFile || initialOpened) return;
    setInitialOpened(true);
    void openFile(initialFile);
  }, [initialFile, initialOpened, openFile]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveFile();
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [saveFile]);

  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const headerTitle = singleFile
    ? `${baseName(currentPath ?? initialFile ?? root)} - 文件`
    : `${baseName(root)} - 工作区`;
  const headerPath =
    singleFile && (currentPath ?? initialFile)
      ? displayPath(`${root}/${currentPath ?? initialFile}`)
      : displayPath(root);
  return (
    <div className="flex h-full w-full flex-col bg-bg text-fg">
      <header className="flex items-center gap-3 border-b border-border bg-bg px-4 py-2">
        <OpenWithButton
          path={root}
          showLabel={false}
          variant="ghost"
          size="sm"
          title="打开根目录"
          onError={(message) => setTreeError(message)}
        />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-fg">
            {headerTitle}
          </div>
          <div className="truncate font-mono text-xs text-fg-muted">
            {headerPath}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {currentPath && dirty && (
            <span className="rounded bg-warning/10 px-2 py-1 text-xs text-warning">
              未保存
            </span>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => void saveFile()}
            disabled={!dirty || saving || Boolean(fileError)}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            保存
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {!singleFile && (
          <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-bg-subtle">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Folder className="h-4 w-4 text-fg-muted" />
              <span className="text-xs font-semibold uppercase tracking-wide text-fg-muted">
                Explorer
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void loadRoot()}
                className="ml-auto h-7 w-7"
                title="刷新"
              >
                {treeLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCcw className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto py-1">
              {treeError ? (
                <StatusMessage tone="danger" text={treeError} />
              ) : treeLoading && entries.length === 0 ? (
                <StatusMessage text="正在加载文件树..." loading />
              ) : entries.length === 0 ? (
                <StatusMessage text="这个文件夹是空的" />
              ) : (
                entries.map((entry) => (
                  <TreeNode
                    key={entry.relative_path}
                    root={root}
                    entry={entry}
                    depth={0}
                    selectedPath={currentPath}
                    onOpenFile={openFile}
                  />
                ))
              )}
            </div>
          </aside>
        )}

        <main className="flex min-w-0 flex-1 flex-col bg-bg">
          <div className="flex h-10 items-center gap-3 border-b border-border bg-bg-subtle px-3">
            {currentPath ? (
              <>
                <FileText className="h-4 w-4 text-fg-muted" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted">
                  {displayPath(currentPath)}
                </span>
                {!fileError && (
                  <span className="rounded border border-border bg-bg px-2 py-0.5 text-xs text-fg-muted">
                    {language}
                  </span>
                )}
              </>
            ) : (
              <span className="text-xs text-fg-muted">选择左侧文件开始编辑</span>
            )}
          </div>

          {saveError && (
            <div className="border-b border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              保存失败：{saveError}
            </div>
          )}

          <div className="min-h-0 flex-1">
            {!currentPath ? (
              <EmptyEditor />
            ) : fileLoading ? (
              <div className="flex h-full items-center justify-center text-fg-muted">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                正在加载文件...
              </div>
            ) : fileError ? (
              <div className="flex h-full items-center justify-center p-8">
                <div className="max-w-lg rounded-xl border border-border bg-bg-subtle p-5 text-center">
                  <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-warning" />
                  <div className="text-sm font-semibold text-fg">无法编辑这个文件</div>
                  <div className="mt-2 break-words text-xs leading-5 text-fg-muted">
                    {fileError}
                  </div>
                </div>
              </div>
            ) : (
              <MonacoEditor
                path={currentPath}
                language={language}
                theme={editorTheme}
                value={content}
                onChange={(value) => setContent(value ?? "")}
                options={{
                  automaticLayout: true,
                  fontSize: 13,
                  minimap: { enabled: true },
                  scrollBeyondLastLine: false,
                  tabSize: 2,
                  wordWrap: "on",
                }}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function TreeNode({ root, entry, depth, selectedPath, onOpenFile }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<WorkspaceEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (!entry.is_dir) {
      onOpenFile(entry.relative_path);
      return;
    }
    const nextExpanded = !expanded;
    setExpanded(nextExpanded);
    if (!nextExpanded || children !== null) return;
    setLoading(true);
    setError(null);
    try {
      const next = await tauri.readWorkspaceDir(root, entry.relative_path);
      setChildren(next);
    } catch (e) {
      setChildren([]);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const selected = selectedPath === entry.relative_path;
  const Icon = entry.is_dir ? (expanded ? FolderOpen : Folder) : FileText;

  return (
    <div>
      <button
        onClick={() => void toggle()}
        className={`flex w-full items-center gap-1.5 truncate py-1 pr-2 text-left text-xs hover:bg-bg-muted ${selected ? "bg-accent/10 text-accent" : "text-fg-muted"}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        title={entry.path}
      >
        {entry.is_dir ? (
          expanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <span className="h-3.5 w-3.5 shrink-0" />
        )}
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
        {!entry.is_dir && (
          <span className="shrink-0 text-[10px] text-fg-subtle">
            {formatBytes(entry.size_bytes)}
          </span>
        )}
      </button>
      {entry.is_dir && expanded && (
        <div>
          {loading ? (
            <div className="flex items-center gap-1.5 py-1 pr-2 text-xs text-fg-subtle" style={{ paddingLeft: 22 + depth * 14 }}>
              <Loader2 className="h-3 w-3 animate-spin" />
              加载中...
            </div>
          ) : error ? (
            <div className="py-1 pr-2 text-xs text-danger" style={{ paddingLeft: 22 + depth * 14 }}>
              {error}
            </div>
          ) : children && children.length > 0 ? (
            children.map((child) => (
              <TreeNode
                key={child.relative_path}
                root={root}
                entry={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                onOpenFile={onOpenFile}
              />
            ))
          ) : (
            <div className="py-1 pr-2 text-xs text-fg-subtle" style={{ paddingLeft: 22 + depth * 14 }}>
              空文件夹
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyEditor() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-center text-fg-muted">
      <div>
        <FileText className="mx-auto mb-3 h-10 w-10 text-fg-subtle" />
        <div className="text-sm font-semibold text-fg">没有打开的文件</div>
        <div className="mt-1 text-xs">从左侧资源管理器选择文本文件进行编辑</div>
      </div>
    </div>
  );
}

function StatusMessage({ text, tone, loading }: { text: string; tone?: "danger"; loading?: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-4 text-xs ${tone === "danger" ? "text-danger" : "text-fg-muted"}`}>
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      <span>{text}</span>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
