import { Skeleton } from "@workspace/ui-kit/skeleton";
import { cn } from "@/lib/utils";

/**
 * Parameterized loading placeholder for tables and lists. Replaces the
 * copy-pasted `{[...Array(n)].map(() => <Skeleton/>)}` blocks across tabs.
 */
export function TableSkeleton({
  rows = 8,
  rowClassName = "h-9",
  className,
}: {
  rows?: number;
  /** Height (and any extra classes) for each row skeleton. */
  rowClassName?: string;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2 p-4", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className={cn("w-full", rowClassName)} />
      ))}
    </div>
  );
}
