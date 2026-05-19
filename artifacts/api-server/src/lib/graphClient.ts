import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";
import NodeCache from "node-cache";
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

export async function getGraphCredentialValues(): Promise<GraphCredentialValues> {
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

export async function getGraphClient(): Promise<Client> {
  const credentials = await getGraphCredentialValues();
  const clientKey = `${credentials.tenantId}:${credentials.clientId}:${credentials.clientSecret}`;

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

export const cache = new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false });

export async function getCached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const cached = cache.get<T>(key);
  if (cached !== undefined) return cached;
  const result = await fetcher();
  cache.set(key, result);
  return result;
}
