import { Router } from "express";
import { fetchGraphJson } from "../lib/collectionIssues.js";
import { loadOnboardingSettings } from "../lib/setupConfig.js";
import {
  getConfiguredApplicationPermissions,
  getRequiredApplicationPermissions,
} from "./onboarding.js";

const router = Router();

type CheckStatus = "ok" | "failed" | "warning";
type CheckCategory = "config" | "auth" | "permission" | "network";

interface ConnectionCheck {
  id: string;
  label: string;
  status: CheckStatus;
  category: CheckCategory;
  message: string;
}

interface OrganizationResponse {
  value?: Array<{
    id?: string;
    displayName?: string;
    verifiedDomains?: Array<{ name?: string; isDefault?: boolean }>;
  }>;
}

/**
 * Lightweight tenant connection test for onboarding/diagnostics. Validates, in
 * order: credentials are configured, a Graph token + tenant identity can be read,
 * and the app's consented application permissions cover the required set. Always
 * responds 200 with a structured result so the UI can render per-check states
 * rather than treating a failed tenant as a dead request.
 */
router.get("/m365/connection-test", async (req, res) => {
  const checks: ConnectionCheck[] = [];

  try {
    const settings = await loadOnboardingSettings();
    const tenantId = settings.tenantId ?? process.env.AZURE_TENANT_ID ?? null;
    const clientId = settings.clientId ?? process.env.AZURE_CLIENT_ID ?? null;

    // 1. Configuration present?
    if (!tenantId || !clientId) {
      checks.push({
        id: "config",
        label: "Credentials configured",
        status: "failed",
        category: "config",
        message: "Tenant ID and/or client ID are not configured. Complete onboarding or set AZURE_TENANT_ID and AZURE_CLIENT_ID.",
      });
      return res.json({ ok: false, checkedAt: new Date().toISOString(), tenant: null, checks, missingRequiredPermissions: [] });
    }
    checks.push({
      id: "config",
      label: "Credentials configured",
      status: "ok",
      category: "config",
      message: "Tenant ID and client ID are present.",
    });

    // 2. Token + tenant identity (a single /organization probe exercises both).
    const orgResult = await fetchGraphJson<OrganizationResponse>(
      "https://graph.microsoft.com/v1.0/organization?$select=id,displayName,verifiedDomains",
      "connection-test:organization",
    );

    let tenant: { id: string | null; displayName: string | null; defaultDomain: string | null } | null = null;

    if (orgResult.issue) {
      const isAuth = orgResult.issue.category === "permission" || orgResult.issue.status === 401;
      checks.push({
        id: "token",
        label: "Acquire Graph token & read tenant",
        status: "failed",
        category: isAuth ? "auth" : "network",
        message: orgResult.issue.message,
      });
      return res.json({ ok: false, checkedAt: new Date().toISOString(), tenant: null, checks, missingRequiredPermissions: [] });
    }

    const org = orgResult.data?.value?.[0] ?? null;
    const defaultDomain = org?.verifiedDomains?.find((d) => d.isDefault)?.name
      ?? org?.verifiedDomains?.[0]?.name
      ?? null;
    tenant = { id: org?.id ?? tenantId, displayName: org?.displayName ?? null, defaultDomain };
    checks.push({
      id: "token",
      label: "Acquire Graph token & read tenant",
      status: "ok",
      category: "auth",
      message: org?.displayName
        ? `Connected to ${org.displayName}${defaultDomain ? ` (${defaultDomain})` : ""}.`
        : "Graph token acquired and tenant identity read.",
    });

    // 3. Required permission coverage.
    const requiredPermissions = getRequiredApplicationPermissions();
    const configured = await getConfiguredApplicationPermissions(clientId);
    if (configured.permissionCheckError) {
      checks.push({
        id: "permissions",
        label: "Required permissions consented",
        status: "warning",
        category: "permission",
        message: `Could not verify consented permissions: ${configured.permissionCheckError}`,
      });
      return res.json({ ok: false, checkedAt: new Date().toISOString(), tenant, checks, missingRequiredPermissions: [] });
    }

    const configuredSet = new Set(configured.permissions);
    const missingRequiredPermissions = requiredPermissions.filter((p) => !configuredSet.has(p));
    checks.push({
      id: "permissions",
      label: "Required permissions consented",
      status: missingRequiredPermissions.length === 0 ? "ok" : "warning",
      category: "permission",
      message: missingRequiredPermissions.length === 0
        ? `All ${requiredPermissions.length} required Graph permissions are consented.`
        : `${missingRequiredPermissions.length} of ${requiredPermissions.length} required permissions are missing admin consent.`,
    });

    const ok = checks.every((c) => c.status === "ok");
    return res.json({ ok, checkedAt: new Date().toISOString(), tenant, checks, missingRequiredPermissions });
  } catch (error) {
    req.log.error({ error }, "Connection test failed unexpectedly");
    checks.push({
      id: "unexpected",
      label: "Connection test",
      status: "failed",
      category: "network",
      message: error instanceof Error ? error.message : "Unexpected connection test failure.",
    });
    return res.json({ ok: false, checkedAt: new Date().toISOString(), tenant: null, checks, missingRequiredPermissions: [] });
  }
});

export default router;
