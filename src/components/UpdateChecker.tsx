import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Progress } from "@/components/ui/Progress";
import {
  checkForUpdate,
  downloadAndInstallUpdate,
  getCurrentVersion,
  type UpdateCheckResult,
} from "@/lib/updater";
import {
  RefreshCw,
  Download,
  Check,
  AlertCircle,
  Loader2,
} from "lucide-react";

type State =
  | "idle"
  | "checking"
  | "no-update"
  | "has-update"
  | "downloading"
  | "error";

export function UpdateChecker() {
  const [state, setState] = useState<State>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>("");

  useEffect(() => {
    getCurrentVersion()
      .then(setCurrentVersion)
      .catch(() => {});
  }, []);

  const handleCheck = useCallback(async () => {
    setState("checking");
    setError(null);
    try {
      const result = await checkForUpdate();
      setUpdateInfo(result);
      setState(result.available ? "has-update" : "no-update");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }, []);

  const handleDownload = useCallback(async () => {
    setState("downloading");
    setProgress(0);
    try {
      await downloadAndInstallUpdate((downloaded, total) => {
        setProgress(Math.round((downloaded / total) * 100));
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-fg-muted">
          当前版本：
          <span className="font-mono text-fg">{currentVersion || "—"}</span>
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCheck}
          disabled={state === "checking" || state === "downloading"}
        >
          {state === "checking" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          检查更新
        </Button>
      </div>

      {state === "no-update" && (
        <p className="flex items-center gap-1.5 text-xs text-fg-muted">
          <Check className="h-3.5 w-3.5 text-success" />
          当前已是最新版本
        </p>
      )}

      {state === "has-update" && updateInfo && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg-subtle p-3">
          <div className="text-xs">
            发现新版本：
            <span className="font-mono font-medium text-accent">
              {updateInfo.newVersion}
            </span>
            <span className="text-fg-muted">
              （当前 {updateInfo.currentVersion}）
            </span>
          </div>
          {updateInfo.body && (
            <pre className="max-h-24 overflow-auto whitespace-pre-wrap text-[11px] text-fg-muted">
              {updateInfo.body}
            </pre>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={handleDownload}
            className="self-start"
          >
            <Download className="h-3.5 w-3.5" />
            下载并安装
          </Button>
        </div>
      )}

      {state === "downloading" && (
        <div className="flex flex-col gap-2">
          <Progress value={progress} />
          <p className="text-xs text-fg-muted">
            正在下载更新… {progress}%
          </p>
        </div>
      )}

      {state === "error" && error && (
        <p className="flex items-center gap-1.5 text-xs text-danger">
          <AlertCircle className="h-3.5 w-3.5" />
          {error}
        </p>
      )}
    </div>
  );
}
