import * as RC from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

type Props = React.ComponentPropsWithoutRef<typeof RC.Root> & {
  indeterminate?: boolean;
};

export const Checkbox = forwardRef<
  React.ElementRef<typeof RC.Root>,
  Props
>(({ className, indeterminate, checked, ...props }, ref) => (
  <RC.Root
    ref={ref}
    checked={indeterminate ? "indeterminate" : checked}
    className={cn(
      "peer h-4 w-4 shrink-0 rounded border border-border-strong",
      "data-[state=checked]:bg-accent data-[state=checked]:border-accent",
      "data-[state=indeterminate]:bg-accent data-[state=indeterminate]:border-accent",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "transition-colors",
      className,
    )}
    {...props}
  >
    <RC.Indicator className="flex items-center justify-center text-accent-fg">
      {indeterminate ? (
        <Minus className="h-3 w-3" strokeWidth={3} />
      ) : (
        <Check className="h-3 w-3" strokeWidth={3} />
      )}
    </RC.Indicator>
  </RC.Root>
));
Checkbox.displayName = "Checkbox";
