import { Router } from "express";
import { getGraphCredentialValues } from "../lib/graphClient.js";
import { withMetadata } from "../lib/metadata.js";

const router = Router();

async function getToken(): Promise<string> {
  const { ClientSecretCredential } = await import("@azure/identity");
  const { tenantId, clientId, clientSecret } = await getGraphCredentialValues();
  const cred = new ClientSecretCredential(
    tenantId,
    clientId,
    clientSecret,
    { tokenCachePersistenceOptions: { enabled: false } }
  );
  const token = await cred.getToken("https://graph.microsoft.com/.default");
  return token!.token;
}

// GET /api/m365/groups?q=searchterm
// Returns all Entra ID groups, optionally filtered by display name / description
router.get("/m365/groups", async (req, res) => {
  try {
    const token = await getToken();
    const q = ((req.query.q as string) ?? "").toLowerCase().trim();

    const url =
      "https://graph.microsoft.com/v1.0/groups" +
      "?$select=id,displayName,description,groupTypes,securityEnabled" +
      "&$top=999" +
      "&$count=true";

    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ConsistencyLevel: "eventual",
      },
    });

    if (!resp.ok) {
      req.log.warn({ status: resp.status }, "Graph API groups error");
      return res.json({ groups: [] });
    }

    const data = await resp.json() as any;
    let groups: Array<{
      id: string;
      displayName: string;
      description?: string;
      groupTypes: string[];
      securityEnabled: boolean;
    }> = data.value ?? [];

    if (q) {
      groups = groups.filter(
        (g) =>
          g.displayName?.toLowerCase().includes(q) ||
          g.description?.toLowerCase().includes(q)
      );
    }

    groups.sort((a, b) => a.displayName.localeCompare(b.displayName));

    return res.json({ groups: groups.slice(0, 100) });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch groups");
    return res.status(500).json({ groups: [], error: "Failed to fetch groups" });
  }
});

router.get("/m365/groups/with-metadata", async (req, res): Promise<void> => {
  try {
    const token = await getToken();
    const q = ((req.query.q as string) ?? "").toLowerCase().trim();

    const url =
      "https://graph.microsoft.com/v1.0/groups" +
      "?$select=id,displayName,description,groupTypes,securityEnabled" +
      "&$top=999" +
      "&$count=true";

    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ConsistencyLevel: "eventual",
      },
    });

    if (!resp.ok) {
      req.log.warn({ status: resp.status }, "Graph API groups error");
      res.json(
        withMetadata(
          { groups: [] },
          {
            groups: {
              evidenceStatus: "partial",
              confidenceLabel: "low",
              sourceLabel: "Group.Read.All",
              notes: ["Graph request failed; returning fallback empty list"],
            },
          }
        )
      );
      return;
    }

    const data = await resp.json() as any;
    let groups: Array<{
      id: string;
      displayName: string;
      description?: string;
      groupTypes: string[];
      securityEnabled: boolean;
    }> = data.value ?? [];

    if (q) {
      groups = groups.filter(
        (g) =>
          g.displayName?.toLowerCase().includes(q) ||
          g.description?.toLowerCase().includes(q)
      );
    }

    groups.sort((a, b) => a.displayName.localeCompare(b.displayName));

    res.json(
      withMetadata(
        { groups: groups.slice(0, 100) },
        {
          groups: {
            evidenceStatus: "apiBacked",
            confidenceLabel: "high",
            sourceLabel: "Group.Read.All",
            notes: ["Groups list from Graph /groups endpoint with optional in-memory query filter"],
          },
        }
      )
    );
    return;
  } catch (err) {
    req.log.error({ err }, "Failed to fetch groups with metadata");
    res.status(500).json({ groups: [], error: "Failed to fetch groups" });
    return;
  }
});

// GET /api/m365/groups/:id/device-members
// Returns the displayName (computer name) of every device object in the group
router.get("/m365/groups/:id/device-members", async (req, res) => {
  try {
    const token = await getToken();
    const groupId = req.params.id;
    const deviceNames: string[] = [];

    let url: string | null =
      `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(groupId)}` +
      `/members/microsoft.graph.device?$select=id,displayName,deviceId`;

    while (url) {
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!resp.ok) {
        req.log.warn({ status: resp.status }, "Graph API device-members error");
        return res.json({ deviceNames: [] });
      }

      const data = await resp.json() as any;
      for (const device of data.value ?? []) {
        if (device.displayName) deviceNames.push(device.displayName as string);
      }
      url = (data["@odata.nextLink"] as string) ?? null;
    }

    return res.json({ deviceNames });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch group device members");
    return res
      .status(500)
      .json({ deviceNames: [], error: "Failed to fetch group device members" });
  }
});

export default router;
