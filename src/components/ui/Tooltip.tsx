import * as T from "@radix-ui/react-tooltip";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export const TooltipProvider = T.Provider;

export function Tooltip({
  children,
  content,
  side = "top",
  delay = 300,
}: {
  children: ReactNode;
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  delay?: number;
}) {
  return (
    <T.Root delayDuration={delay}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-50 max-w-xs rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-fg shadow-lg",
            "animate-fade-in",
          )}
        >
          {content}
          <T.Arrow className="fill-bg" />
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
