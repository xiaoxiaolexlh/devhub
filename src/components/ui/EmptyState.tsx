import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: ReactNode;
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-bg-subtle/50 px-6 py-12 text-center",
        className,
      )}
    >
      {icon && (
        <div className="mb-3.5 flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent">
          {icon}
        </div>
      )}
      {title && <h3 className="text-sm font-semibold text-fg">{title}</h3>}
      {description && (
        <p className="mt-1 max-w-sm text-xs leading-relaxed text-fg-muted">
          {description}
        </p>
      )}
      {action && <div className="mt-4 flex items-center gap-2">{action}</div>}
    </div>
  );
}
