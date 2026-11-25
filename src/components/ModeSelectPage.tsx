import { Button } from "@/components/ui/Button";
import { useApp, type AppMode } from "@/stores/app";
import { ArrowRight, Search, Settings } from "lucide-react";
import { APP_MODES } from "@/lib/modes";

interface Props {
  onOpenSettings: () => void;
}

interface ModeCardProps {
  mode: AppMode;
  title: string;
  desc: string;
  icon: React.ReactNode;
  highlights: string[];
}

export function ModeSelectPage({ onOpenSettings }: Props) {
  const { setAppMode } = useApp();

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-bg text-fg">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-bg-subtle/80 px-6 py-3.5 backdrop-blur-sm">
        <div>
          <h1 className="text-base font-semibold text-fg">选择工作台模式</h1>
          <p className="text-xs text-fg-muted">根据工作内容进入对应模块，或按 Ctrl+K 全局搜索</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              window.dispatchEvent(
                new KeyboardEvent("keydown", { key: "k", ctrlKey: true }),
              );
            }}
            className="hidden items-center gap-2 rounded-lg border border-border bg-bg px-2.5 py-1.5 text-xs text-fg-muted shadow-sm transition hover:border-accent hover:text-fg sm:flex"
            title="搜索所有工作台"
          >
            <Search className="h-3.5 w-3.5 text-fg-subtle" />
            <span>搜索工作台...</span>
            <kbd className="rounded bg-bg-muted px-1 py-0.5 text-[10px] text-fg-subtle">
              Ctrl+K
            </kbd>
          </button>
          <Button variant="ghost" size="md" onClick={onOpenSettings}>
            <Settings className="h-4 w-4" />
            设置
          </Button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center p-8">
          <div className="grid w-full max-w-6xl grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {APP_MODES.map((item) => {
              const Icon = item.icon;
              return <ModeCard key={item.mode} {...item} icon={<Icon className="h-8 w-8" />} onSelect={setAppMode} />;
            })}

          </div>
        </div>
      </main>
    </div>
  );
}

function ModeCard({ mode, title, desc, icon, highlights, onSelect }: ModeCardProps & { onSelect: (mode: AppMode) => void }) {
  return (
    <button
      onClick={() => onSelect(mode)}
      className="group flex min-h-72 flex-col rounded-2xl border border-border bg-bg-subtle p-6 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-accent hover:shadow-lg"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-accent/10 text-accent">
        {icon}
      </div>
      <div className="mt-5">
        <h2 className="text-xl font-semibold text-fg">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-fg-muted">{desc}</p>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {highlights.map((item) => (
          <span key={item} className="rounded-full border border-border bg-bg px-2.5 py-1 text-xs text-fg-muted">
            {item}
          </span>
        ))}
      </div>
      <div className="mt-auto flex items-center justify-end pt-8 text-sm font-medium text-accent">
        进入
        <ArrowRight className="ml-1 h-4 w-4 transition group-hover:translate-x-0.5" />
      </div>
    </button>
  );
}
