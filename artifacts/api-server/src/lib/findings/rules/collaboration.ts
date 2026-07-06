import type { RuleDefinition } from "./helpers.js";
import { cis, ce } from "../frameworks/catalogue.js";

/** Minimal shape of the m365-sharepoint-policies snapshot. */
interface PoliciesSlice {
  sharingCapability?: string | null;
  oneDriveSharingCapability?: string | null;
  anyoneLinkExpirationInDays?: number | null;
}

/** Minimal shape of the m365-sharepoint-sharing snapshot. */
interface SharingSlice {
  totalSharingLinks?: number;
  orgWideLinks?: number;
  anonymousLinks?: number;
  sampledSites?: number;
}

/** Minimal shape of the m365-teams snapshot. */
interface TeamsSlice {
  totalTeams?: number;
  guestAccessEnabled?: boolean;
}

/** Composite snapshot assembled by the engine for the collaboration domain. */
export interface CollaborationData {
  policies: PoliciesSlice | null;
  sharing: SharingSlice | null;
  teams: TeamsSlice | null;
}

/** Sharing capabilities that permit unauthenticated "anyone" / anonymous links. */
const ANONYMOUS_CAPABLE = new Set(["ExternalUserAndGuestSharing"]);

export const collaborationRules: RuleDefinition<CollaborationData>[] = [
  {
    ruleId: "collaboration.externalSharing",
    category: "collaboration",
    title: "External sharing is appropriately restricted",
    description: "SharePoint external sharing does not permit unauthenticated anyone links by default",
    severity: "medium",
    metricId: "collaboration.finding.externalSharing",
    remediation: "Restrict the tenant sharing capability so anonymous 'Anyone' links are not allowed unless justified.",
    frameworks: [cis("7.2.3"), ce("SC")],
    evaluate: (d) => {
      if (!d?.policies || d.policies.sharingCapability == null) return null;
      const cap = d.policies.sharingCapability;
      const status = ANONYMOUS_CAPABLE.has(cap) ? "warning" : "pass";
      return [{ checkStatus: status, detail: `sharing capability: ${cap}` }];
    },
  },
  {
    ruleId: "collaboration.anonymousLinkExpiry",
    category: "collaboration",
    title: "Anonymous sharing links expire",
    description: "When anonymous links are allowed, an expiration is configured",
    severity: "low",
    metricId: "collaboration.finding.anonymousLinkExpiry",
    remediation: "Set an expiration (e.g. 30 days) for Anyone links in the SharePoint sharing settings.",
    frameworks: [cis("7.2.3"), ce("SC")],
    evaluate: (d) => {
      if (!d?.policies || d.policies.sharingCapability == null) return null;
      if (!ANONYMOUS_CAPABLE.has(d.policies.sharingCapability)) {
        return [{ checkStatus: "pass", detail: "anonymous links not permitted" }];
      }
      const days = d.policies.anyoneLinkExpirationInDays ?? 0;
      return [{ checkStatus: days > 0 ? "pass" : "warning", detail: days > 0 ? `${days} day expiry` : "no expiry configured" }];
    },
  },
  {
    ruleId: "collaboration.anonymousLinksPresent",
    category: "collaboration",
    title: "Anonymous sharing links are minimal",
    description: "Sampled SharePoint sites have few or no anonymous sharing links",
    severity: "medium",
    metricId: "collaboration.finding.anonymousLinksPresent",
    remediation: "Review and remove anonymous sharing links on sensitive sites; prefer specific-people links.",
    frameworks: [cis("7.2.3"), ce("SC")],
    evaluate: (d) => {
      if (!d?.sharing || d.sharing.sampledSites === undefined) return null;
      const anon = d.sharing.anonymousLinks ?? 0;
      return [{
        checkStatus: anon === 0 ? "pass" : "warning",
        detail: anon === 0 ? "none in sampled sites" : `${anon} anonymous link(s) in ${d.sharing.sampledSites} sampled site(s)`,
      }];
    },
  },
  {
    ruleId: "collaboration.teamsGuestGovernance",
    category: "collaboration",
    title: "Teams guest access is governed",
    description: "Guest access to Teams is reviewed against governance policy",
    severity: "medium",
    metricId: "collaboration.finding.teamsGuestGovernance",
    remediation: "Confirm Teams guest access policy and run periodic guest access reviews.",
    frameworks: [ce("UAC")],
    // Teams guest/external flags are not yet reliably collected (placeholder values),
    // so this remains a manual check rather than asserting a state.
    evaluate: () => [{ checkStatus: "manual" }],
  },
];
