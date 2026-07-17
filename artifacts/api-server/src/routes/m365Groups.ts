import { Router } from "express";
import {
  GetM365GroupDeviceMembersParams,
  GetM365GroupsQueryParams,
  GetM365GroupsWithMetadataQueryParams,
} from "@workspace/api-zod";
import { fetchResourceWithRetry } from "../lib/collectionIssues.js";
import { withMetadata } from "../lib/metadata.js";
import { validate } from "../middlewares/validate.js";

const router = Router();

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

interface GroupItem {
  id: string;
  displayName: string;
  description?: string;
  groupTypes: string[];
  securityEnabled: boolean;
}

// GET /api/m365/groups?q=searchterm
// Returns all Entra ID groups, optionally filtered by display name / description
router.get("/m365/groups", validate({ query: GetM365GroupsQueryParams }), async (req, res) => {
  try {
    const query = req.valid!.query as { q?: string };
    const q = (query.q ?? "").toLowerCase().trim();

    const url =
      "https://graph.microsoft.com/v1.0/groups" +
      "?$select=id,displayName,description,groupTypes,securityEnabled" +
      "&$top=999" +
      "&$count=true";

    const resp = await fetchResourceWithRetry(url, GRAPH_SCOPE, { ConsistencyLevel: "eventual" });

    if (!resp.ok) {
      req.log.warn({ status: resp.status }, "Graph API groups error");
      return res.json({ groups: [] });
    }

    const data = (await resp.json()) as { value?: GroupItem[] };
    let groups: GroupItem[] = data.value ?? [];

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

router.get(
  "/m365/groups/with-metadata",
  validate({ query: GetM365GroupsWithMetadataQueryParams }),
  async (req, res): Promise<void> => {
  try {
    const query = req.valid!.query as { q?: string };
    const q = (query.q ?? "").toLowerCase().trim();

    const url =
      "https://graph.microsoft.com/v1.0/groups" +
      "?$select=id,displayName,description,groupTypes,securityEnabled" +
      "&$top=999" +
      "&$count=true";

    const resp = await fetchResourceWithRetry(url, GRAPH_SCOPE, { ConsistencyLevel: "eventual" });

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

    const data = (await resp.json()) as { value?: GroupItem[] };
    let groups: GroupItem[] = data.value ?? [];

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
router.get(
  "/m365/groups/:id/device-members",
  validate({ params: GetM365GroupDeviceMembersParams }),
  async (req, res) => {
  try {
    const params = req.valid!.params as { id: string };
    const groupId = params.id;
    const deviceNames: string[] = [];

    let url: string | null =
      `https://graph.microsoft.com/v1.0/groups/${encodeURIComponent(groupId)}` +
      `/members/microsoft.graph.device?$select=id,displayName,deviceId`;

    while (url) {
      const resp: Response = await fetchResourceWithRetry(url, GRAPH_SCOPE);

      if (!resp.ok) {
        req.log.warn({ status: resp.status }, "Graph API device-members error");
        return res.json({ deviceNames: [] });
      }

      const data = (await resp.json()) as { value?: Array<{ displayName?: string }>; "@odata.nextLink"?: string };
      for (const device of data.value ?? []) {
        if (device.displayName) deviceNames.push(device.displayName);
      }
      url = data["@odata.nextLink"] ?? null;
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
