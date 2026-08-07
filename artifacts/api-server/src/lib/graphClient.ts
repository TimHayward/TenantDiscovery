import { createHash } from "node:crypto";
import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";
import { assertNoOutboundCallsInDemoMode } from "./fixtures/demoMode.js";
import { loadOnboardingSettings } from "./setupConfig.js";

export interface GraphCredentialValues {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

function normalize(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Every outbound path to Microsoft passes through this module: `getGraphClient`
 * builds the SDK client, and `getGraphCredentialValues` is what the collectors'
 * token acquisition asks for before it can issue a request. Refusing here is
 * therefore the whole of the outbound block in demonstration mode — there is no
 * second route to a token — and it is deliberately an exception rather than a
 * silent no-op, so a code path that still expects a live tenant fails visibly
 * instead of quietly reporting an empty result.
 */
export async function getGraphCredentialValues(): Promise<GraphCredentialValues> {
  assertNoOutboundCallsInDemoMode("a Microsoft Graph credential request");

  const envTenantId = normalize(process.env.AZURE_TENANT_ID);
  const envClientId = normalize(process.env.AZURE_CLIENT_ID);
  const envClientSecret = normalize(process.env.AZURE_CLIENT_SECRET);

  const settings = await loadOnboardingSettings();
  const tenantId = envTenantId ?? normalize(settings.tenantId);
  const clientId = envClientId ?? normalize(settings.clientId);
  const clientSecret = envClientSecret ?? normalize(settings.clientSecret);

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      "Microsoft Graph credentials are not configured. Set AZURE_TENANT_ID/AZURE_CLIENT_ID/AZURE_CLIENT_SECRET or complete onboarding setup.",
    );
  }

  return { tenantId, clientId, clientSecret };
}

let cachedClient: Client | null = null;
let cachedClientKey: string | null = null;

export function hashCredentials(credentials: GraphCredentialValues): string {
  return createHash("sha256")
    .update(`${credentials.tenantId}:${credentials.clientId}:${credentials.clientSecret}`)
    .digest("hex");
}

export async function getGraphClient(): Promise<Client> {
  assertNoOutboundCallsInDemoMode("a Microsoft Graph client");

  const credentials = await getGraphCredentialValues();
  const clientKey = hashCredentials(credentials);

  if (cachedClient && cachedClientKey === clientKey) {
    return cachedClient;
  }

  const credential = new ClientSecretCredential(
    credentials.tenantId,
    credentials.clientId,
    credentials.clientSecret,
  );

  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ["https://graph.microsoft.com/.default"],
  });

  cachedClient = Client.initWithMiddleware({ authProvider });
  cachedClientKey = clientKey;

  return cachedClient;
}
