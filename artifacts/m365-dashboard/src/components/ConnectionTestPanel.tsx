import { useGetM365ConnectionTest } from "@workspace/api-client-react";
import type { ConnectionCheck } from "@workspace/api-client-react";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw, Loader2 } from "lucide-react";

const STATUS_ICON: Record<ConnectionCheck["status"], typeof CheckCircle2> = {
  ok: CheckCircle2,
  failed: XCircle,
  warning: AlertTriangle,
};

const STATUS_COLOR: Record<ConnectionCheck["status"], string> = {
  ok: "text-green-600 dark:text-green-400",
  failed: "text-red-600 dark:text-red-400",
  warning: "text-amber-600 dark:text-amber-400",
};

/**
 * Diagnostics panel that runs the tenant connection test (token, tenant identity
 * and required-permission consent) and renders each check's status. Lets an
 * operator validate onboarding in one click instead of inferring it from empty
 * dashboard sections.
 */
export function ConnectionTestPanel() {
  const { data, isLoading, refetch, isRefetching } = useGetM365ConnectionTest();
  const busy = isLoading || isRefetching;

  const description = data?.tenant?.displayName
    ? `Connected to ${data.tenant.displayName}${data.tenant.defaultDomain ? ` (${data.tenant.defaultDomain})` : ""}`
    : "Validate Graph credentials, tenant identity and required permissions";

  return (
    <CollapsibleSection
      title="Tenant Connection Test"
      description={description}
      storageKey="overview-connection-test"
      defaultOpen={false}
      density="compact"
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refetch()}
          disabled={busy}
          className="h-7 gap-1.5 text-xs"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Re-run
        </Button>
      }
    >
      {busy && !data ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Running connection test…
        </div>
      ) : data ? (
        <div className="space-y-2">
          {data.checks.map((check) => {
            const Icon = STATUS_ICON[check.status];
            return (
              <div key={check.id} className="flex items-start gap-2.5 rounded-md border px-3 py-2">
                <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${STATUS_COLOR[check.status]}`} />
                <div className="min-w-0">
                  <div className="text-sm font-medium leading-tight">{check.label}</div>
                  <div className="text-xs text-muted-foreground break-words">{check.message}</div>
                </div>
              </div>
            );
          })}
          {data.missingRequiredPermissions.length > 0 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300">
              <div className="font-semibold">Missing required permissions</div>
              <div className="mt-1 font-mono break-words">{data.missingRequiredPermissions.join(", ")}</div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">No connection test result available.</div>
      )}
    </CollapsibleSection>
  );
}
