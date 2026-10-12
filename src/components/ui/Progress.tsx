import * as P from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";

export function Progress({
  value,
  max = 100,
  className,
}: {
  value: number;
  max?: number;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <P.Root
      value={pct}
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-bg-muted",
        className,
      )}
    >
      <P.Indicator
        className="h-full bg-accent transition-transform duration-200"
        style={{ transform: `translateX(-${100 - pct}%)` }}
      />
    </P.Root>
  );
}
