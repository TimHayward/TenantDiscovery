import { Router, type NextFunction, type Request, type Response } from "express";
import { getDemoProfile } from "../lib/fixtures/demoMode.js";
// The required/recommended permission lists are derived by the onboarding
// route from the manifest. Reusing them keeps the demonstration reply in step
// with the live one when the manifest gains a permission.
import {
  getRecommendedApplicationPermissions,
  getRequiredApplicationPermissions,
} from "./onboarding.js";
import { loadManifest, type FixtureManifest } from "../lib/fixtures/loader.js";

const router = Router();

/**
 * The header carried by every response the API produces in demonstration mode.
 * A client that never looks at a body — a proxy log, a `curl -I`, a screenshot
 * of the network tab — can still tell that the data is fictional.
 */
export const DEMO_MODE_HEADER = "X-Demo-Mode";

/** The property injected into every JSON object body in demonstration mode. */
export const DEMO_MODE_FLAG = "demoMode";

export interface DemoModeDescriptor {
  demoMode: boolean;
  profile: string | null;
  name: string | null;
  description: string | null;
  recordedAt: string | null;
  synthetic: boolean | null;
  schemaVersion: number | null;
}

function describe(profile: string, manifest: FixtureManifest | null): DemoModeDescriptor {
  return {
    demoMode: true,
    profile,
    name: manifest?.name ?? null,
    description: manifest?.description ?? null,
    recordedAt: manifest?.recordedAt ?? null,
    synthetic: manifest?.synthetic ?? null,
    schemaVersion: manifest?.schemaVersion ?? null,
  };
}

const OFF: DemoModeDescriptor = {
  demoMode: false,
  profile: null,
  name: null,
  description: null,
  recordedAt: null,
  synthetic: null,
  schemaVersion: null,
};

/**
 * Mark every response as demonstration data.
 *
 * The flag has to travel with the data rather than be compiled into the
 * dashboard, because the failure this guards against is a production build of
 * the dashboard pointed at a demonstration server: a build-time constant would
 * say "live" and the screenshot would be indistinguishable from an assessment.
 *
 * `res.json` is wrapped rather than each route edited, because there are
 * twenty-six routers and a route added tomorrow must be flagged too. Bodies
 * that are not plain objects (arrays, strings) are left alone — there is
 * nowhere to put the property — and those responses carry only the header.
 */
function flagDemoResponses(req: Request, res: Response, next: NextFunction): void {
  const profile = getDemoProfile();
  if (profile === null) return next();

  res.setHeader(DEMO_MODE_HEADER, profile);

  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      return originalJson({ ...(body as Record<string, unknown>), [DEMO_MODE_FLAG]: profile });
    }
    return originalJson(body);
  };
  next();
}

router.use(flagDemoResponses);

/**
 * What the dashboard's banner reads. Answers in both modes, so the client makes
 * one unconditional request and does not have to treat a 404 as "live".
 */
router.get("/m365/demo-mode", async (req, res): Promise<void> => {
  const profile = getDemoProfile();
  if (profile === null) {
    res.json(OFF);
    return;
  }
  try {
    res.json(describe(profile, await loadManifest()));
  } catch (err) {
    // A missing or malformed manifest must not be able to turn the banner off:
    // report demonstration mode with whatever is known and log the rest.
    req.log.warn({ err, profile }, "Could not read the demonstration fixture manifest");
    res.json(describe(profile, null));
  }
});

/**
 * Satisfy the onboarding gate in demonstration mode.
 *
 * The live handler decides from a saved client ID and a live Graph consent
 * check, both of which demonstration mode deliberately does not have, so it
 * would route every visitor to the onboarding page and the dashboard would
 * never render. Mounted ahead of the real router and only when `DEMO_MODE` is
 * set; with it unset this route is not reached and the live handler answers.
 *
 * The reply is shaped exactly like the live one so the dashboard needs no
 * special case, and it reports every required permission as configured because
 * the fixture does in fact carry the data those permissions would have
 * collected.
 */
router.get("/onboarding/status", async (req, res, next): Promise<void> => {
  const profile = getDemoProfile();
  if (profile === null) return next();

  const manifest = await loadManifest().catch(() => null);
  const required = getRequiredApplicationPermissions();
  const recommended = getRecommendedApplicationPermissions();
  const now = new Date(0).toISOString();

  res.json({
    targetClientId: `demo-client-${profile}`,
    targetTenantId: `demo-tenant-${profile}`,
    targetAppDisplayName: `${manifest?.name ?? profile} (demonstration fixture)`,
    requiredApplicationPermissions: required,
    recommendedApplicationPermissions: recommended,
    configuredApplicationPermissions: [...required, ...recommended].sort((a, b) =>
      a.localeCompare(b),
    ),
    missingRequiredPermissions: [],
    missingRecommendedPermissions: [],
    hasMissingRequiredPermissions: false,
    allRequiredPermissionsMissing: false,
    canContinueWithMissingPermissions: false,
    permissionCheckError: null,
    permissionCheckSucceeded: true,
    needsOnboarding: false,
    setup: {
      tenantId: `demo-tenant-${profile}`,
      clientId: `demo-client-${profile}`,
      clientSecret: null,
      hasClientSecret: false,
      hasApiToken: false,
      setupComplete: true,
      setupCompletedAt: manifest?.recordedAt ?? now,
      acknowledgedMissingPermissions: [],
      createdAt: manifest?.recordedAt ?? now,
      updatedAt: manifest?.recordedAt ?? now,
    },
  });
  req.log.debug({ profile }, "Answered onboarding status from the demonstration fixture");
});

/**
 * Answer the connection test from the fixture in demonstration mode.
 *
 * The live handler proves a token can be issued and permissions are consented,
 * which demonstration mode has deliberately made impossible. Left alone it puts
 * a red "credentials not configured" panel on the Overview tab of an otherwise
 * complete demonstration, which reads as a broken product rather than as a
 * tenant-free one. Every check is reported as satisfied *by the fixture*, and
 * the tenant it names says so, so the panel cannot be mistaken for a live
 * connection to anything.
 */
router.get("/m365/connection-test", async (req, res, next): Promise<void> => {
  const profile = getDemoProfile();
  if (profile === null) return next();

  const manifest = await loadManifest().catch(() => null);
  const check = (id: string, label: string) => ({
    id,
    label,
    status: "ok" as const,
    category: "config" as const,
    message: `Served from the "${profile}" demonstration fixture. Nothing was contacted.`,
  });

  res.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    tenant: {
      id: `demo-tenant-${profile}`,
      displayName: `${manifest?.name ?? profile} (demonstration fixture)`,
      defaultDomain: `${profile}.example`,
    },
    checks: [
      check("config", "Credentials configured"),
      check("auth", "Token acquired"),
      check("permissions", "Application permissions consented"),
    ],
    missingRequiredPermissions: [],
  });
  req.log.debug({ profile }, "Answered the connection test from the demonstration fixture");
});

export default router;
