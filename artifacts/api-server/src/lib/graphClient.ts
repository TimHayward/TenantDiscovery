import { ClientSecretCredential } from "@azure/identity";
import { Client } from "@microsoft/microsoft-graph-client";
import { TokenCredentialAuthenticationProvider } from "@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js";
import NodeCache from "node-cache";

const tenantId = process.env.AZURE_TENANT_ID;
const clientId = process.env.AZURE_CLIENT_ID;
const clientSecret = process.env.AZURE_CLIENT_SECRET;

if (!tenantId || !clientId || !clientSecret) {
  throw new Error(
    "AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET must be set."
  );
}

const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);

const authProvider = new TokenCredentialAuthenticationProvider(credential, {
  scopes: ["https://graph.microsoft.com/.default"],
});

export const graphClient = Client.initWithMiddleware({ authProvider });

export const cache = new NodeCache({ stdTTL: 300, checkperiod: 60, useClones: false });

export async function getCached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const cached = cache.get<T>(key);
  if (cached !== undefined) return cached;
  const result = await fetcher();
  cache.set(key, result);
  return result;
}
