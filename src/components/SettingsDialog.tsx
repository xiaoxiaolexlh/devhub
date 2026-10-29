import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
  DialogClose,
} from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { useApp } from "@/stores/app";
import {
  type Editor,
  type HBuilderXProjectGroup,
  type HBuilderXProject,
  type OpenMethod,
  type Settings,
  type Theme,
  type ConflictStrategy,
} from "@/lib/tauri";
import { Trash2, Plus, FolderOpen, Check, X, Star } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Checkbox } from "@/components/ui/Checkbox";
import { UpdateChecker } from "@/components/UpdateChecker";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: Props) {
  const { settings, saveSettings } = useApp();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && settings) {
      // deep clone
      setDraft(JSON.parse(JSON.stringify(settings)));
    }
  }, [open, settings]);

  if (!draft) return null;

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  function updateEditor(idx: number, patch: Partial<Editor>) {
    setDraft((d) => {
      if (!d) return d;
      const editors = d.editors.map((e, i) => (i === idx ? { ...e, ...patch } : e));
      return { ...d, editors };
    });
  }

  function deleteEditor(idx: number) {
    setDraft((d) => {
      if (!d) return d;
      const editors = d.editors.filter((_, i) => i !== idx);
      return { ...d, editors };
    });
  }

  function updateProjectConfigDir(idx: number, value: string) {
    setDraft((d) => {
      if (!d) return d;
      const project_config_dirs = d.project_config_dirs.map((item, i) =>
        i === idx ? value : item,
      );
      return { ...d, project_config_dirs };
    });
  }

  function addProjectConfigDir() {
    setDraft((d) =>
      d ? { ...d, project_config_dirs: [...d.project_config_dirs, ""] } : d,
    );
  }

  function deleteProjectConfigDir(idx: number) {
    setDraft((d) => {
      if (!d) return d;
      return {
        ...d,
        project_config_dirs: d.project_config_dirs.filter((_, i) => i !== idx),
      };
    });
  }

  function addProjectRoot(path: string) {
    const trimmed = path.trim();
    if (!trimmed) return;
    setDraft((d) => {
      if (!d) return d;
      const exists = d.project_roots.some(
        (p) => p.toLowerCase() === trimmed.toLowerCase(),
      );
      return exists ? d : { ...d, project_roots: [...d.project_roots, trimmed] };
    });
  }

  function updateProjectRoot(idx: number, value: string) {
    setDraft((d) => {
      if (!d) return d;
      const project_roots = d.project_roots.map((item, i) =>
        i === idx ? value : item,
      );
      return { ...d, project_roots };
    });
  }

  function deleteProjectRoot(idx: number) {
    setDraft((d) => {
      if (!d) return d;
      return { ...d, project_roots: d.project_roots.filter((_, i) => i !== idx) };
    });
  }

  function updateHBuilderXCliDir(value: string) {
    update("hbuilderx_cli_dir", value);
  }

  function updateHBuilderXProject(idx: number, patch: Partial<HBuilderXProject>) {
    setDraft((d) => {
      if (!d) return d;
      const hbuilderx_projects = d.hbuilderx_projects.map((project, i) =>
        i === idx ? { ...project, ...patch } : project,
      );
      return { ...d, hbuilderx_projects };
    });
  }

  function deleteHBuilderXProject(idx: number) {
    setDraft((d) => {
      if (!d) return d;
      return {
        ...d,
        hbuilderx_projects: d.hbuilderx_projects.filter((_, i) => i !== idx),
      };
    });
  }

  async function addCustomEditor() {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "选择自定义编辑器的扩展目录",
    });
    if (!picked || typeof picked !== "string") return;
    setDraft((d) => {
      if (!d) return d;
      const id = `custom-${Date.now()}`;
      const newEd: Editor = {
        id,
        name: "自定义编辑器",
        path: picked,
        built_in: false,
        process_names: [],
      };
      return { ...d, editors: [...d.editors, newEd] };
    });
  }

  function updateOpenMethod(idx: number, patch: Partial<OpenMethod>) {
    setDraft((d) => {
      if (!d) return d;
      const open_methods = d.open_methods.map((m, i) =>
        i === idx ? { ...m, ...patch } : m,
      );
      return { ...d, open_methods };
    });
  }

  function deleteOpenMethod(idx: number) {
    setDraft((d) => {
      if (!d) return d;
      const removed = d.open_methods[idx];
      if (!removed || removed.built_in) return d;
      const open_methods = d.open_methods.filter((_, i) => i !== idx);
      const default_open_method_id =
        d.default_open_method_id === removed.id
          ? open_methods.find((m) => m.id === "explorer")?.id ??
            open_methods[0]?.id ??
            "explorer"
          : d.default_open_method_id;
      return { ...d, open_methods, default_open_method_id };
    });
  }

  function addCustomOpenMethod() {
    setDraft((d) => {
      if (!d) return d;
      const method: OpenMethod = {
        id: `open-${Date.now()}`,
        name: "自定义打开方式",
        kind: "external_app",
        built_in: false,
        enabled: true,
        command: "",
        args_template: '"{path}"',
      };
      return { ...d, open_methods: [...(d.open_methods ?? []), method] };
    });
  }

  async function pickOpenMethodCommand(idx: number) {
    const picked = await openDialog({
      multiple: false,
      defaultPath: draft?.open_methods[idx]?.command || undefined,
      title: "选择可执行文件",
      filters: [{ name: "可执行文件", extensions: ["exe", "cmd", "bat"] }],
    });
    if (picked && typeof picked === "string") {
      updateOpenMethod(idx, { command: picked });
    }
  }

  async function pickPath(idx: number) {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: draft?.editors[idx]?.path,
      title: "选择扩展目录",
    });
    if (picked && typeof picked === "string") {
      updateEditor(idx, { path: picked });
    }
  }

  async function pickProjectRoot() {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "选择固定项目目录",
    });
    if (picked && typeof picked === "string") {
      addProjectRoot(picked);
    }
  }

  async function pickHBuilderXCliDir() {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: draft?.hbuilderx_cli_dir,
      title: "选择 HBuilderX CLI 所在文件夹",
    });
    if (picked && typeof picked === "string") {
      updateHBuilderXCliDir(picked);
    }
  }

  async function addHBuilderXProject() {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "选择 HBuilderX CLI 项目目录",
    });
    if (!picked || typeof picked !== "string") return;
    const name = picked.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "uni-app 项目";
    const project: HBuilderXProject = {
      id: `hbx-${Date.now()}`,
      name,
      path: picked,
      run: {
        web: {
          browser: "Built",
          ui: false,
          compile: false,
          continue_on_error: false,
        },
      },
      publish: {
        web: {},
        app_resource: {
          platform: "APP",
          copy_enabled: false,
          copy_source_dir: "",
          copy_target_dir: "",
        },
        mp_alipay: {
          appid: "",
          upload: false,
          description: "",
          version: "",
          privatekey: "",
          sub_package: "",
        },
      },
    };
    setDraft((d) =>
      d ? { ...d, hbuilderx_projects: [...d.hbuilderx_projects, project] } : d,
    );
  }

  async function pickHBuilderXProject(idx: number) {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: draft?.hbuilderx_projects[idx]?.path,
      title: "选择项目目录",
    });
    if (picked && typeof picked === "string") {
      updateHBuilderXProject(idx, { path: picked });
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const normalized = normalizeSettings(draft);
      await saveSettings(normalized);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const projectConfigDirIssues = getProjectConfigDirIssues(draft.project_config_dirs);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent width="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">设置</DialogTitle>
          <DialogDescription className="text-xs text-fg-muted">
            管理编辑器扩展目录与默认行为
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-6">
            <section>
              <SectionHeader
                title="编辑器目录"
                desc="主源编辑器的扩展目录是同步的源头,其他作为目标"
              />
              <div className="flex flex-col gap-2">
                {draft.editors.map((e, i) => (
                  <div
                    key={e.id}
                    className="flex items-center gap-2 rounded-lg border border-border bg-bg-subtle p-2"
                  >
                    <button
                      onClick={() => update("source_editor", e.id)}
                      className={`flex h-7 w-7 items-center justify-center rounded-full border ${
                        draft.source_editor === e.id
                          ? "border-accent bg-accent text-accent-fg"
                          : "border-border-strong text-fg-subtle hover:border-accent hover:text-accent"
                      }`}
                      title="设为主源"
                    >
                      {draft.source_editor === e.id ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <span className="text-[10px] font-bold">源</span>
                      )}
                    </button>
                    <Input
                      value={e.name}
                      onChange={(ev) =>
                        updateEditor(i, { name: ev.target.value })
                      }
                      className="w-32 shrink-0"
                      disabled={e.built_in}
                    />
                    <Input
                      value={e.path}
                      onChange={(ev) =>
                        updateEditor(i, { path: ev.target.value })
                      }
                      className="flex-1 font-mono text-xs"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => pickPath(i)}
                      title="选择目录"
                    >
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteEditor(i)}
                      disabled={e.built_in || draft.source_editor === e.id}
                      title={
                        e.built_in
                          ? "内置编辑器不可删除"
                          : draft.source_editor === e.id
                            ? "源编辑器不可删除"
                            : "删除"
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    {e.built_in && (
                      <span className="rounded bg-bg-muted px-1.5 py-0.5 text-[10px] text-fg-muted">
                        内置
                      </span>
                    )}
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addCustomEditor}
                  className="self-start"
                >
                  <Plus className="h-3.5 w-3.5" /> 添加自定义编辑器
                </Button>
              </div>
            </section>

            <section>
              <SectionHeader
                title="打开方式"
                desc="用资源管理器、内置工作区或外部编辑器打开文件夹；星标为默认打开方式"
              />
              <div className="flex flex-col gap-2">
                {(draft.open_methods ?? []).map((method, i) => {
                  const isExternal = method.kind === "external_app";
                  const isDefault = draft.default_open_method_id === method.id;
                  return (
                    <div
                      key={method.id}
                      className="flex flex-col gap-2 rounded-lg border border-border bg-bg-subtle p-2"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => update("default_open_method_id", method.id)}
                          className={`flex h-7 w-7 items-center justify-center rounded-full border ${
                            isDefault
                              ? "border-accent bg-accent text-accent-fg"
                              : "border-border-strong text-fg-subtle hover:border-accent hover:text-accent"
                          }`}
                          title="设为默认打开方式"
                        >
                          <Star className={`h-3.5 w-3.5 ${isDefault ? "fill-current" : ""}`} />
                        </button>
                        <label className="flex items-center gap-1.5 text-xs text-fg-muted">
                          <Checkbox
                            checked={method.enabled}
                            onCheckedChange={(checked) =>
                              updateOpenMethod(i, { enabled: checked === true })
                            }
                          />
                          启用
                        </label>
                        <Input
                          value={method.name}
                          onChange={(ev) =>
                            updateOpenMethod(i, { name: ev.target.value })
                          }
                          className="w-36 shrink-0"
                          disabled={method.built_in && !isExternal}
                          title={method.built_in ? "内置项" : undefined}
                        />
                        <span className="rounded bg-bg-muted px-1.5 py-0.5 text-[10px] text-fg-muted">
                          {method.kind === "explorer"
                            ? "资源管理器"
                            : method.kind === "workspace"
                              ? "内置工作区"
                              : "外部程序"}
                        </span>
                        {method.built_in && (
                          <span className="rounded bg-bg-muted px-1.5 py-0.5 text-[10px] text-fg-muted">
                            内置
                          </span>
                        )}
                        <div className="ml-auto">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => deleteOpenMethod(i)}
                            disabled={method.built_in}
                            title={method.built_in ? "内置打开方式不可删除" : "删除"}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      {isExternal && (
                        <div className="flex flex-col gap-2 pl-9">
                          <div className="flex items-center gap-2">
                            <span className="w-16 shrink-0 text-[11px] text-fg-muted">程序</span>
                            <Input
                              value={method.command}
                              onChange={(ev) =>
                                updateOpenMethod(i, { command: ev.target.value })
                              }
                              placeholder="可执行文件路径，或 PATH 中的命令名（如 code）"
                              className="flex-1 font-mono text-xs"
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => void pickOpenMethodCommand(i)}
                              title="选择可执行文件"
                            >
                              <FolderOpen className="h-4 w-4" />
                            </Button>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="w-16 shrink-0 text-[11px] text-fg-muted">参数</span>
                            <Input
                              value={method.args_template}
                              onChange={(ev) =>
                                updateOpenMethod(i, { args_template: ev.target.value })
                              }
                              placeholder='"{path}"'
                              className="flex-1 font-mono text-xs"
                            />
                          </div>
                          {method.enabled && !method.command.trim() && (
                            <p className="text-[11px] text-warning">
                              尚未配置可执行文件，打开菜单中将显示为禁用
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addCustomOpenMethod}
                  className="self-start"
                >
                  <Plus className="h-3.5 w-3.5" /> 添加打开方式
                </Button>
              </div>
            </section>

            <section>
              <SectionHeader
                title="项目配置目录"
                desc="项目配置同步会按这里的目录名扫描和复制"
              />
              <div className="flex flex-col gap-2">
                {draft.project_config_dirs.map((dir, i) => {
                  const issue = projectConfigDirIssues.get(i);
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 rounded-lg border border-border bg-bg-subtle p-2"
                    >
                      <Input
                        value={dir}
                        onChange={(ev) =>
                          updateProjectConfigDir(i, ev.target.value)
                        }
                        placeholder=".windsurf"
                        className="font-mono text-xs"
                      />
                      {issue && (
                        <span className="w-24 shrink-0 text-xs text-danger">
                          {issue}
                        </span>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteProjectConfigDir(i)}
                        title="删除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addProjectConfigDir}
                  className="self-start"
                >
                  <Plus className="h-3.5 w-3.5" /> 添加配置目录
                </Button>
              </div>
            </section>

            <section>
              <SectionHeader
                title="固定项目库"
                desc="项目配置同步页会优先展示这些常用项目"
              />
              <div className="flex flex-col gap-2">
                {draft.project_roots.map((path, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-lg border border-border bg-bg-subtle p-2"
                  >
                    <Input
                      value={path}
                      onChange={(ev) => updateProjectRoot(i, ev.target.value)}
                      className="flex-1 font-mono text-xs"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteProjectRoot(i)}
                      title="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={pickProjectRoot}
                  className="self-start"
                >
                  <Plus className="h-3.5 w-3.5" /> 添加固定项目
                </Button>
              </div>
            </section>

            <section>
              <SectionHeader
                title="HBuilderX CLI"
                desc="配置 CLI 文件夹和常用 uni-app 项目"
              />
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-bg-subtle p-2">
                <Input
                  value={draft.hbuilderx_cli_dir}
                  onChange={(ev) => updateHBuilderXCliDir(ev.target.value)}
                  placeholder="HBuilderX 安装目录或 cli.exe 所在文件夹"
                  className="font-mono text-xs"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={pickHBuilderXCliDir}
                  title="选择 CLI 文件夹"
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-col gap-2">
                {draft.hbuilderx_projects.map((project, i) => (
                  <div
                    key={project.id}
                    className="grid grid-cols-[140px_1fr_auto_auto] items-center gap-2 rounded-lg border border-border bg-bg-subtle p-2"
                  >
                    <Input
                      value={project.name}
                      onChange={(ev) =>
                        updateHBuilderXProject(i, { name: ev.target.value })
                      }
                      placeholder="项目名称"
                    />
                    <Input
                      value={project.path}
                      onChange={(ev) =>
                        updateHBuilderXProject(i, { path: ev.target.value })
                      }
                      className="font-mono text-xs"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => pickHBuilderXProject(i)}
                      title="选择项目目录"
                    >
                      <FolderOpen className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteHBuilderXProject(i)}
                      title="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addHBuilderXProject}
                  className="self-start"
                >
                  <Plus className="h-3.5 w-3.5" /> 添加 CLI 项目
                </Button>
              </div>
            </section>

            <section>
              <SectionHeader
                title="默认行为"
                desc="复制冲突策略与备份保留时长"
              />
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <Field label="冲突策略">
                  <Select
                    value={draft.conflict_strategy}
                    onChange={(e) =>
                      update(
                        "conflict_strategy",
                        e.target.value as ConflictStrategy,
                      )
                    }
                  >
                    <option value="ask">每次询问</option>
                    <option value="skip">同名跳过</option>
                    <option value="overwrite">同名覆盖</option>
                  </Select>
                </Field>
                <Field label="回收站保留(天)">
                  <Input
                    type="number"
                    min={0}
                    max={365}
                    value={draft.backup_days}
                    onChange={(e) =>
                      update("backup_days", parseInt(e.target.value || "0"))
                    }
                    className="w-24"
                  />
                </Field>
                <Field label="主题">
                  <Select
                    value={draft.theme}
                    onChange={(e) => update("theme", e.target.value as Theme)}
                  >
                    <option value="system">跟随系统</option>
                    <option value="light">浅色</option>
                    <option value="dark">深色</option>
                  </Select>
                </Field>
              </div>
            </section>

            <section>
              <SectionHeader
                title="检查更新"
                desc="检查并安装 DevHub 的最新版本"
              />
              <UpdateChecker />
            </section>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={saving}>
              <X className="h-4 w-4" />
              取消
            </Button>
          </DialogClose>
          <Button
            variant="primary"
            onClick={save}
            disabled={saving || projectConfigDirIssues.size > 0}
          >
            <Check className="h-4 w-4" />
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SectionHeader({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {desc && <p className="text-xs text-fg-muted">{desc}</p>}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex items-center gap-3">
      <span className="w-32 shrink-0 text-xs font-medium text-fg-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

function normalizeSettings(settings: Settings): Settings {
  const open_methods = (settings.open_methods ?? [])
    .map((method) => ({
      ...method,
      id: method.id.trim(),
      name: method.name.trim(),
      command: method.command.trim(),
      args_template: method.args_template.trim() || '"{path}"',
    }))
    .filter((method) => method.id && method.name);

  let default_open_method_id = settings.default_open_method_id?.trim() || "explorer";
  if (!open_methods.some((m) => m.id === default_open_method_id)) {
    default_open_method_id =
      open_methods.find((m) => m.id === "explorer")?.id ?? open_methods[0]?.id ?? "explorer";
  }

  return {
    ...settings,
    project_config_dirs: uniqueTrimmed(settings.project_config_dirs),
    project_roots: uniqueTrimmed(settings.project_roots),
    hbuilderx_projects: settings.hbuilderx_projects.filter(
      (project) => project.name.trim() || project.path.trim(),
    ),
    hbuilderx_project_groups: normalizeHBuilderXProjectGroups(
      settings.hbuilderx_project_groups ?? [],
      settings.hbuilderx_projects.map((project) => project.id),
    ),
    open_methods,
    default_open_method_id,
  };
}

function normalizeHBuilderXProjectGroups(
  groups: HBuilderXProjectGroup[],
  projectIds: string[],
) {
  const known = new Set(projectIds);
  const assigned = new Set<string>();
  return groups
    .filter((group) => group.name.trim() || group.project_ids.length > 0)
    .map((group, index) => {
      const project_ids = group.project_ids.filter((id) => {
        if (!known.has(id) || assigned.has(id)) return false;
        assigned.add(id);
        return true;
      });
      return {
        ...group,
        id: group.id || `hbx-group-${index + 1}`,
        name: group.name.trim() || "分组",
        project_ids,
        collapsed: Boolean(group.collapsed),
      };
    });
}

function uniqueTrimmed(items: string[]) {
  const out: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (out.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
      continue;
    }
    out.push(trimmed);
  }
  return out;
}

function getProjectConfigDirIssues(items: string[]) {
  const issues = new Map<number, string>();
  const seen = new Map<string, number>();
  items.forEach((item, idx) => {
    const trimmed = item.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed) {
      issues.set(idx, "不能为空");
      return;
    }
    if (!trimmed.startsWith(".")) {
      issues.set(idx, "需以 . 开头");
      return;
    }
    if (seen.has(key)) {
      issues.set(idx, "重复");
      const first = seen.get(key);
      if (first !== undefined) issues.set(first, "重复");
      return;
    }
    seen.set(key, idx);
  });
  return issues;
}
