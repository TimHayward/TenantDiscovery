import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, TriangleAlert, HelpCircle } from "lucide-react";
import {
  getPermissionDefinition,
  type PermissionAccessKind,
} from "@workspace/permissions-manifest";
import { getOnboardingStatus } from "@/lib/onboardingApi";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface PermissionRow {
  name: string;
  accessKind: PermissionAccessKind;
  summary: string;
  granted: boolean;
}

/**
 * Human label for a permission's access kind. The app registration is app-only
 * (client-credentials), so every permission listed here is an "application"
 * permission — there are no delegated grants in this application.
 */
function accessKindLabel(accessKind: PermissionAccessKind): string {
  switch (accessKind) {
    case "application":
      return "Application";
    case "external-scope":
      return "External API scope";
    default:
      return accessKind;
  }
}

function PermissionTable({
  rows,
  grantStatusKnown,
}: {
  rows: PermissionRow[];
  grantStatusKnown: boolean;
}) {
  return (
    <div className="border rounded-md overflow-hidden bg-card">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Permission</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.name}>
                <TableCell
                  className="font-mono text-[12px] whitespace-nowrap"
                  title={row.summary}
                >
                  {row.name}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <Badge variant="secondary">{accessKindLabel(row.accessKind)}</Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {!grantStatusKnown ? (
                    <span className="inline-flex items-center gap-1 text-muted-foreground text-[12px]">
                      <HelpCircle className="h-3.5 w-3.5" />
                      Unknown
                    </span>
                  ) : row.granted ? (
                    <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400 text-[12px] font-medium">
                      <Check className="h-3.5 w-3.5" />
                      Granted
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 text-[12px] font-medium">
                      <TriangleAlert className="h-3.5 w-3.5" />
                      Missing
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function toRows(names: string[], configured: Set<string>): PermissionRow[] {
  return names
    .map((name) => {
      const def = getPermissionDefinition(name);
      return {
        name,
        accessKind: def?.accessKind ?? "application",
        summary: def?.summary ?? "",
        granted: configured.has(name),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function SettingsTab() {
  // Shares App.tsx / Dashboard's query key, so React Query serves this from cache.
  const { data: onboarding, isLoading } = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: getOnboardingStatus,
  });

  // Live grant status is only meaningful when the tenant permission check ran.
  const grantStatusKnown = onboarding?.permissionCheckSucceeded ?? false;

  const { mandatory, recommended } = useMemo(() => {
    if (!onboarding) return { mandatory: [] as PermissionRow[], recommended: [] as PermissionRow[] };
    const configured = new Set(onboarding.configuredApplicationPermissions);
    return {
      mandatory: toRows(onboarding.requiredApplicationPermissions, configured),
      recommended: toRows(onboarding.recommendedApplicationPermissions, configured),
    };
  }, [onboarding]);

  const hasRows = mandatory.length > 0 || recommended.length > 0;

  const grantedLabel = (rows: PermissionRow[]) =>
    grantStatusKnown ? ` — ${rows.filter((r) => r.granted).length}/${rows.length} granted` : "";

  return (
    <div className="space-y-4">
      <CollapsibleSection
        title="Permissions"
        description="Microsoft Graph application permissions this app registration uses, their access kind, and whether each is currently granted on the tenant's app registration."
        storageKey="settings-permissions"
        sectionId="settings-permissions"
        defaultOpen={true}
        density="compact"
      >
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading permissions…</p>
        ) : !hasRows ? (
          <p className="text-sm text-muted-foreground">No permission information is available.</p>
        ) : (
          <div className="space-y-5">
            {!grantStatusKnown && (
              <p className="text-[12px] text-amber-700 dark:text-amber-400">
                Live grant status is unavailable
                {onboarding?.permissionCheckError ? ` (${onboarding.permissionCheckError})` : ""} — showing the
                mandatory and recommended permissions without their current tenant status.
              </p>
            )}

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">
                Mandatory
                <span className="ml-1 font-normal text-muted-foreground">
                  ({mandatory.length}){grantedLabel(mandatory)}
                </span>
              </h3>
              <p className="text-[12px] text-muted-foreground">
                Required for data collection — dependent tabs stay empty until these are granted and consented.
              </p>
              <PermissionTable rows={mandatory} grantStatusKnown={grantStatusKnown} />
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">
                Recommended
                <span className="ml-1 font-normal text-muted-foreground">
                  ({recommended.length}){grantedLabel(recommended)}
                </span>
              </h3>
              <p className="text-[12px] text-muted-foreground">
                Optional — their absence only empties the individual sections that depend on them.
              </p>
              <PermissionTable rows={recommended} grantStatusKnown={grantStatusKnown} />
            </div>

            <p className="text-[11px] text-muted-foreground">
              &ldquo;Granted&rdquo; means the permission is present on the app registration. Permissions still
              require admin consent to take effect — a granted permission may continue to be reported as missing
              on a tab until consent is completed and data is re-collected.
            </p>
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}
