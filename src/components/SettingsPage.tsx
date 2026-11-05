import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog, confirm } from "@tauri-apps/plugin-dialog";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  FolderGit2,
  FolderKanban,
  FolderOpen,
  Loader2,
  MousePointerClick,
  Plus,
  Puzzle,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Star,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Checkbox } from "@/components/ui/Checkbox";
import { UpdateChecker } from "@/components/UpdateChecker";
import { cn } from "@/lib/utils";
import {
  type ConflictStrategy,
  type Editor,
  type HBuilderXProject,
  type HBuilderXProjectGroup,
  type OpenMethod,
  type Settings,
  type Theme,
} from "@/lib/tauri";
import { useApp } from "@/stores/app";

type SectionId =
  | "editors"
  | "open-methods"
  | "project-configs"
  | "project-roots"
  | "hbuilderx"
  | "defaults"
  | "update";

const SECTIONS: {
  id: SectionId;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "editors", title: "编辑器目录", icon: Puzzle },
  { id: "open-methods", title: "打开方式", icon: MousePointerClick },
  { id: "project-configs", title: "项目配置目录", icon: FolderGit2 },
  { id: "project-roots", title: "固定项目库", icon: FolderKanban },
  { id: "hbuilderx", title: "HBuilderX CLI", icon: TerminalSquare },
  { id: "defaults", title: "默认行为", icon: SlidersHorizontal },
  { id: "update", title: "检查更新", icon: RefreshCw },
];

export function SettingsPage() {
  const { settings, saveSettings, setAppMode, settingsReturnMode } = useApp();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>("editors");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Partial<Record<SectionId, HTMLElement | null>>>({});

  useEffect(() => {
    if (settings) {
      setDraft(JSON.parse(JSON.stringify(settings)) as Settings);
    }
  }, [settings]);

  const dirty = useMemo(
    () => Boolean(draft && settings && JSON.stringify(draft) !== JSON.stringify(settings)),
    [draft, settings],
  );

  // 滚动时高亮左侧当前分组（以内容区顶部为基准取最后一个已到达顶部的分组）
  const sectionsReady = draft !== null;
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !sectionsReady) return;
    const updateActive = () => {
      const anchorTop = root.getBoundingClientRect().top;
      let current = SECTIONS[0].id;
      for (const section of SECTIONS) {
        const el = sectionRefs.current[section.id];
        if (!el) continue;
        if (el.getBoundingClientRect().top - anchorTop <= 72) {
          current = section.id;
        }
      }
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 8) {
        current = SECTIONS[SECTIONS.length - 1].id;
      }
      setActiveSection((prev) => (prev === current ? prev : current));
    };
    updateActive();
    root.addEventListener("scroll", updateActive, { passive: true });
    window.addEventListener("resize", updateActive);
    return () => {
      root.removeEventListener("scroll", updateActive);
      window.removeEventListener("resize", updateActive);
    };
  }, [sectionsReady]);

  const goBack = useCallback(async () => {
    if (dirty) {
      const ok = await confirm("当前有未保存的修改，确定要离开设置吗？", {
        title: "放弃修改",
        kind: "warning",
        okLabel: "放弃并离开",
        cancelLabel: "继续编辑",
      });
      if (!ok) return;
    }
    setAppMode(settingsReturnMode);
  }, [dirty, setAppMode, settingsReturnMode]);

  function jumpTo(id: SectionId) {
    setActiveSection(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (!draft) {
    return (
      <div className="flex h-full w-full flex-col bg-bg text-fg">
        <SettingsHeader
          dirty={false}
          invalid={false}
          saving={false}
          onBack={() => setAppMode(settingsReturnMode)}
          onSave={() => {}}
        />
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-fg-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载设置…
        </div>
      </div>
    );
  }

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
        cloud_pack: {
          platform: "android",
          iscustom: false,
          safemode: false,
          source_map: false,
          dsyms: false,
          isconfusion: false,
          splashads: false,
          rpads: false,
          unimpads: false,
          ad_domestic: "",
          ad_international: "",
          ad_content: "",
          ignore_warnings: false,
          android: {
            packagename: "",
            androidpacktype: "1",
            certalias: "",
            certfile: "",
            certpassword: "",
            storepassword: "",
            channels: "",
            anti_resign_appid: false,
            anti_resign_package_name: false,
            anti_resign_certificate: false,
          },
          ios: {
            bundle: "",
            supporteddevice: "iPhone",
            channels: "",
            profile: "",
            certfile: "",
            certpassword: "",
          },
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

  const projectConfigDirIssues = getProjectConfigDirIssues(draft.project_config_dirs);
  const invalid = projectConfigDirIssues.size > 0;

  async function save() {
    if (!draft) return;
    setSaving(true);
    setNotice(null);
    try {
      const normalized = normalizeSettings(draft);
      await saveSettings(normalized);
      setDraft(JSON.parse(JSON.stringify(normalized)) as Settings);
      setNotice({ tone: "success", text: "设置已保存" });
    } catch (error) {
      setNotice({ tone: "error", text: String(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-bg text-fg">
      <SettingsHeader
        dirty={dirty}
        invalid={invalid}
        saving={saving}
        onBack={() => void goBack()}
        onSave={() => void save()}
      />

      {notice && (
        <div
          className={cn(
            "flex items-center gap-2 border-b px-5 py-2 text-sm",
            notice.tone === "success"
              ? "border-success/20 bg-success/5 text-success"
              : "border-danger/20 bg-danger/5 text-danger",
          )}
        >
          {notice.tone === "success" ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <CircleAlert className="h-3.5 w-3.5" />
          )}
          {notice.text}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <nav className="w-52 shrink-0 overflow-y-auto border-r border-border bg-bg-subtle/60 p-2.5">
          <div className="px-2 pb-2 pt-1 text-[11px] font-medium uppercase tracking-wide text-fg-subtle">
            设置分组
          </div>
          <div className="flex flex-col gap-0.5">
            {SECTIONS.map((section) => {
              const Icon = section.icon;
              const active = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => jumpTo(section.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
                    active
                      ? "bg-accent/10 font-medium text-accent"
                      : "text-fg-muted hover:bg-bg-muted hover:text-fg",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      active ? "text-accent" : "text-fg-subtle",
                    )}
                  />
                  {section.title}
                </button>
              );
            })}
          </div>
        </nav>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-3xl flex-col gap-5 px-8 py-6">
            <SettingsCard
              id="editors"
              icon={Puzzle}
              title="编辑器目录"
              desc="主源编辑器的扩展目录是同步的源头，其他编辑器作为目标。点击左侧圆形按钮切换主源。"
              refs={sectionRefs}
            >
              <div className="flex flex-col gap-2">
                {draft.editors.map((e, i) => (
                  <div
                    key={e.id}
                    className="flex items-center gap-2 rounded-xl border border-border bg-bg p-2"
                  >
                    <button
                      type="button"
                      onClick={() => update("source_editor", e.id)}
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors",
                        draft.source_editor === e.id
                          ? "border-accent bg-accent text-accent-fg"
                          : "border-border-strong text-fg-subtle hover:border-accent hover:text-accent",
                      )}
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
                      onChange={(ev) => updateEditor(i, { name: ev.target.value })}
                      className="w-32 shrink-0"
                      disabled={e.built_in}
                    />
                    <Input
                      value={e.path}
                      onChange={(ev) => updateEditor(i, { path: ev.target.value })}
                      className="flex-1 font-mono text-xs"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => void pickPath(i)}
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
                    {e.built_in && <Badge>内置</Badge>}
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void addCustomEditor()}
                  className="self-start"
                >
                  <Plus className="h-3.5 w-3.5" /> 添加自定义编辑器
                </Button>
              </div>
            </SettingsCard>

            <SettingsCard
              id="open-methods"
              icon={MousePointerClick}
              title="打开方式"
              desc="用资源管理器、内置工作区或外部编辑器打开文件夹；星标为默认打开方式。"
              refs={sectionRefs}
            >
              <div className="flex flex-col gap-2">
                {(draft.open_methods ?? []).map((method, i) => {
                  const isExternal = method.kind === "external_app";
                  const isDefault = draft.default_open_method_id === method.id;
                  return (
                    <div
                      key={method.id}
                      className="flex flex-col gap-2 rounded-xl border border-border bg-bg p-2.5"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => update("default_open_method_id", method.id)}
                          className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-colors",
                            isDefault
                              ? "border-accent bg-accent text-accent-fg"
                              : "border-border-strong text-fg-subtle hover:border-accent hover:text-accent",
                          )}
                          title="设为默认打开方式"
                        >
                          <Star
                            className={cn("h-3.5 w-3.5", isDefault && "fill-current")}
                          />
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
                        <Badge>
                          {method.kind === "explorer"
                            ? "资源管理器"
                            : method.kind === "workspace"
                              ? "内置工作区"
                              : "外部程序"}
                        </Badge>
                        {method.built_in && <Badge>内置</Badge>}
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
                            <span className="w-16 shrink-0 text-[11px] text-fg-muted">
                              程序
                            </span>
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
                            <span className="w-16 shrink-0 text-[11px] text-fg-muted">
                              参数
                            </span>
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
            </SettingsCard>

            <SettingsCard
              id="project-configs"
              icon={FolderGit2}
              title="项目配置目录"
              desc="项目配置同步会按这里的目录名扫描和复制，目录名需以 . 开头。"
              refs={sectionRefs}
            >
              <div className="flex flex-col gap-2">
                {draft.project_config_dirs.map((dir, i) => {
                  const issue = projectConfigDirIssues.get(i);
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2 rounded-xl border border-border bg-bg p-2"
                    >
                      <Input
                        value={dir}
                        onChange={(ev) => updateProjectConfigDir(i, ev.target.value)}
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
            </SettingsCard>

            <SettingsCard
              id="project-roots"
              icon={FolderKanban}
              title="固定项目库"
              desc="项目配置同步页会优先展示这些常用项目。"
              refs={sectionRefs}
            >
              <div className="flex flex-col gap-2">
                {draft.project_roots.map((path, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-xl border border-border bg-bg p-2"
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
                  onClick={() => void pickProjectRoot()}
                  className="self-start"
                >
                  <Plus className="h-3.5 w-3.5" /> 添加固定项目
                </Button>
              </div>
            </SettingsCard>

            <SettingsCard
              id="hbuilderx"
              icon={TerminalSquare}
              title="HBuilderX CLI"
              desc="配置 CLI 文件夹和常用 uni-app 项目。"
              refs={sectionRefs}
            >
              <div className="mb-3 flex items-center gap-2 rounded-xl border border-border bg-bg p-2">
                <Input
                  value={draft.hbuilderx_cli_dir}
                  onChange={(ev) => updateHBuilderXCliDir(ev.target.value)}
                  placeholder="HBuilderX 安装目录或 cli.exe 所在文件夹"
                  className="font-mono text-xs"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => void pickHBuilderXCliDir()}
                  title="选择 CLI 文件夹"
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-col gap-2">
                {draft.hbuilderx_projects.map((project, i) => (
                  <div
                    key={project.id}
                    className="grid grid-cols-[140px_1fr_auto_auto] items-center gap-2 rounded-xl border border-border bg-bg p-2"
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
                      onClick={() => void pickHBuilderXProject(i)}
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
                  onClick={() => void addHBuilderXProject()}
                  className="self-start"
                >
                  <Plus className="h-3.5 w-3.5" /> 添加 CLI 项目
                </Button>
              </div>
            </SettingsCard>

            <SettingsCard
              id="defaults"
              icon={SlidersHorizontal}
              title="默认行为"
              desc="复制冲突策略、回收站保留时长与界面主题。"
              refs={sectionRefs}
            >
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <Field label="冲突策略">
                  <Select
                    value={draft.conflict_strategy}
                    onChange={(e) =>
                      update("conflict_strategy", e.target.value as ConflictStrategy)
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
            </SettingsCard>

            <SettingsCard
              id="update"
              icon={RefreshCw}
              title="检查更新"
              desc="检查并安装 DevHub 的最新版本。"
              refs={sectionRefs}
            >
              <UpdateChecker />
            </SettingsCard>

            <div className="flex items-center justify-between gap-3 pb-2">
              <p className="text-xs text-fg-muted">
                {dirty ? "有未保存的修改" : "所有修改已保存"}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (settings) {
                      setDraft(JSON.parse(JSON.stringify(settings)) as Settings);
                      setNotice(null);
                    }
                  }}
                  disabled={!dirty || saving}
                  title="放弃所有未保存的修改"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  还原
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void save()}
                  disabled={!dirty || saving || invalid}
                >
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  保存设置
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsHeader({
  dirty,
  invalid,
  saving,
  onBack,
  onSave,
}: {
  dirty: boolean;
  invalid: boolean;
  saving: boolean;
  onBack: () => void;
  onSave: () => void;
}) {
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-border bg-bg/95 px-4 py-2.5 backdrop-blur-sm">
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="text-fg-muted hover:text-fg"
        title="返回上一工作台"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        返回
      </Button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-sm font-semibold text-fg">设置</h1>
          {dirty && (
            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
              未保存
            </span>
          )}
        </div>
        <div className="truncate text-xs text-fg-muted">
          管理编辑器扩展目录、打开方式与默认行为
        </div>
      </div>
      <div className="flex items-center gap-2">
        {invalid && (
          <span className="flex items-center gap-1 text-xs text-danger">
            <CircleAlert className="h-3.5 w-3.5" />
            请先修正项目配置目录
          </span>
        )}
        <Button
          variant="primary"
          size="sm"
          onClick={onSave}
          disabled={!dirty || saving || invalid}
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          保存
        </Button>
      </div>
    </header>
  );
}

function SettingsCard({
  id,
  icon: Icon,
  title,
  desc,
  refs,
  children,
}: {
  id: SectionId;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc?: string;
  refs: React.MutableRefObject<Partial<Record<SectionId, HTMLElement | null>>>;
  children: React.ReactNode;
}) {
  return (
    <section
      data-section={id}
      ref={(el) => {
        refs.current[id] = el;
      }}
      className="scroll-mt-6 rounded-2xl border border-border bg-bg-subtle p-5 shadow-sm"
    >
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-fg">{title}</h2>
          {desc && <p className="mt-0.5 text-xs leading-5 text-fg-muted">{desc}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 rounded bg-bg-muted px-1.5 py-0.5 text-[10px] text-fg-muted">
      {children}
    </span>
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
      open_methods.find((m) => m.id === "explorer")?.id ??
      open_methods[0]?.id ??
      "explorer";
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
