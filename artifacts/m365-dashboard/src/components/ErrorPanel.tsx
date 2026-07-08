import { AlertTriangle, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Shared error state for data tabs and sections. Rendered whenever a query's
 * `isError` is set, so a failed fetch reads as a failure with a retry action
 * instead of a healthy-looking empty/zeroed view.
 */
export function ErrorPanel({
  title = "Couldn't load this data",
  error,
  onRetry,
}: {
  title?: string;
  /** The query error; its message is shown when available. */
  error?: unknown;
  /** Wire to the failed query's `refetch`. */
  onRetry?: () => void;
}) {
  const message =
    error instanceof Error ? error.message : typeof error === "string" && error ? error : null;
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <AlertTriangle className="h-8 w-8 text-amber-500" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium">{title}</p>
          {message && (
            <p className="mt-1 max-w-md break-words text-xs text-muted-foreground">{message}</p>
          )}
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Subtle inline indicator for background refetches. Tabs render this next to
 * their root (with the root positioned `relative`) while `isFetching && !isLoading`,
 * instead of blanking mounted content back to skeletons.
 */
export function RefreshIndicator({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div
      className="pointer-events-none absolute -top-1 right-0 z-10 flex items-center gap-1.5 text-[11px] text-muted-foreground print:hidden"
      role="status"
      aria-live="polite"
    >
      <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
      Refreshing…
    </div>
  );
}
