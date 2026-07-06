import { entityOutcomesOrPass, type RuleDefinition, type RuleOutcome } from "./helpers.js";

/** Minimal shape of the m365-licenses snapshot consumed by these rules. */
interface LicensesSlice {
  licenses?: Array<{
    skuId?: string;
    skuPartNumber?: string;
    displayName?: string;
    total?: number;
    assigned?: number;
    available?: number;
  }>;
}

/** Minimal shape of the m365-users snapshot consumed by these rules. */
interface UsersSlice {
  ghostLicensedCount?: number;
  estimatedMonthlyWaste?: number;
}

/** Composite snapshot assembled by the engine for the licensing domain. */
export interface LicensingData {
  licenses: LicensesSlice | null;
  users: UsersSlice | null;
}

// Surface a SKU as a review candidate only when there is meaningful unused inventory,
// to avoid noise on small or fully-consumed SKUs.
const MIN_UNUSED_UNITS = 5;
const UNUSED_RATIO = 0.25;

export const licensingRules: RuleDefinition<LicensingData>[] = [
  {
    ruleId: "licensing.unusedInventory",
    category: "licensing",
    title: "Unused licence inventory (review candidate)",
    description: "A SKU has a significant number of unassigned licences",
    severity: "low",
    metricId: "licensing.finding.unusedInventory",
    remediation: "Review unassigned licences against forecast demand; reduce on renewal if persistently unused.",
    evaluate: (d) => {
      if (!d?.licenses?.licenses) return null;
      const offenders: RuleOutcome[] = d.licenses.licenses
        .filter((s) => {
          const total = s.total ?? 0;
          const available = s.available ?? 0;
          return total > 0 && available >= MIN_UNUSED_UNITS && available / total >= UNUSED_RATIO;
        })
        .map((s) => ({
          target: s.skuId ?? s.skuPartNumber ?? "unknown",
          targetLabel: s.displayName || s.skuPartNumber || "unknown SKU",
          checkStatus: "warning",
          detail: `${s.available} of ${s.total} unassigned`,
          evidence: s,
        }));
      return entityOutcomesOrPass(offenders, "No SKUs with significant unused inventory");
    },
  },
  {
    ruleId: "licensing.inactiveLicenceSpend",
    category: "licensing",
    title: "Licensed accounts are inactive (review candidate)",
    description: "Licensed accounts inactive beyond the threshold represent reviewable spend",
    severity: "low",
    metricId: "licensing.finding.inactiveLicenceSpend",
    remediation: "Review inactive licensed accounts (mind shared mailboxes, leavers on hold) before reclaiming licences.",
    evaluate: (d) => {
      if (!d?.users || d.users.ghostLicensedCount === undefined) return null;
      const n = d.users.ghostLicensedCount;
      const waste = d.users.estimatedMonthlyWaste ?? 0;
      return [{
        checkStatus: n === 0 ? "pass" : "warning",
        detail: n === 0 ? "No inactive licensed accounts" : `${n} inactive licensed account(s)${waste ? `, ~£${waste}/mo` : ""}`,
      }];
    },
  },
];
