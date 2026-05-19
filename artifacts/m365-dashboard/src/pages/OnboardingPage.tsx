import { useMemo, useState } from "react";
import { AlertCircle, LockKeyhole, RefreshCw, ShieldAlert } from "lucide-react";
import { PermissionCodeList } from "@/components/PermissionCodeList";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  type OnboardingStatus,
  patchOnboardingSetup,
} from "@/lib/onboardingApi";

interface OnboardingPageProps {
  status: OnboardingStatus;
  onRefreshStatus: () => Promise<void>;
}

export default function OnboardingPage({
  status,
  onRefreshStatus,
}: OnboardingPageProps) {
  const [tenantId, setTenantId] = useState(status.setup.tenantId ?? status.targetTenantId ?? "");
  const [clientId, setClientId] = useState(status.setup.clientId ?? status.targetClientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const missingCount = status.missingRequiredPermissions.length;
  const targetLabel =
    status.targetAppDisplayName ?? status.targetClientId ?? "the configured app registration";
  const canSubmit = Boolean(clientId.trim());

  const guidanceText = useMemo(() => {
    if (missingCount === 0) {
      return "Required permissions appear configured. Refresh to re-check and continue.";
    }
    return `Grant admin consent for ${missingCount} missing required application permission${
      missingCount === 1 ? "" : "s"
    }.`;
  }, [missingCount]);

  const handleSave = async () => {
    if (!canSubmit) return;
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      await patchOnboardingSetup({
        tenantId,
        clientId,
        clientSecret: clientSecret.trim() ? clientSecret : undefined,
        setupComplete: true,
      });

      setClientSecret("");
      setSaveSuccess("Setup details were saved securely on the server.");
      await onRefreshStatus();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to save setup details.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setSaveError(null);
    try {
      await onRefreshStatus();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Failed to refresh onboarding status.");
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="min-h-screen bg-background px-5 py-6">
      <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <ShieldAlert className="h-5 w-5 text-amber-600" />
              Required application permissions are missing
            </CardTitle>
            <CardDescription>
              The dashboard is blocked until required Microsoft Graph application permissions are present.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>App registration in scope</AlertTitle>
              <AlertDescription>
                Checking permissions for <span className="font-medium">{targetLabel}</span>.
              </AlertDescription>
            </Alert>

            <div>
              <p className="mb-2 text-sm text-muted-foreground">Missing required permissions</p>
              {status.missingRequiredPermissions.length > 0 ? (
                <div className="rounded-md border bg-amber-50/60 p-3 text-sm leading-relaxed text-foreground">
                  <PermissionCodeList
                    permissions={status.missingRequiredPermissions}
                    codeClassName="mx-0.5 rounded bg-amber-200/70 px-1 py-0.5 text-[12px]"
                    conjunction="and"
                  />
                </div>
              ) : (
                <div className="rounded-md border bg-green-50/60 p-3 text-sm text-foreground">
                  No missing required application permissions were detected.
                </div>
              )}
            </div>

            {status.permissionCheckError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Permission check failed</AlertTitle>
                <AlertDescription>{status.permissionCheckError}</AlertDescription>
              </Alert>
            )}

            <div className="flex items-center gap-2">
              <Button onClick={handleRefresh} variant="outline" disabled={isRefreshing}>
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
                Re-check permissions
              </Button>
              <span className="text-xs text-muted-foreground">{guidanceText}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <LockKeyhole className="h-5 w-5 text-primary" />
              Save setup details securely
            </CardTitle>
            <CardDescription>
              Credentials are persisted server-side with secret redaction in API responses.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="tenant-id" className="text-sm font-medium">
                Tenant ID
              </label>
              <Input
                id="tenant-id"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="client-id" className="text-sm font-medium">
                Client ID (required)
              </label>
              <Input
                id="client-id"
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="client-secret" className="text-sm font-medium">
                Client secret
              </label>
              <Input
                id="client-secret"
                type="password"
                placeholder={status.setup.hasClientSecret ? "Secret already stored" : "Paste new secret"}
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to keep the existing stored secret unchanged.
              </p>
            </div>

            <Button onClick={handleSave} disabled={!canSubmit || isSaving} className="w-full">
              {isSaving ? "Saving..." : "Save secure setup details"}
            </Button>

            {saveError && <p className="text-sm text-red-600">{saveError}</p>}
            {saveSuccess && <p className="text-sm text-green-700">{saveSuccess}</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
