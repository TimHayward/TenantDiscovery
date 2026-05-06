# Evidence Status Framework Semantics

## Overview

The Evidence Status Framework distinguishes between **control assessment outcomes** and **evidence sources**. This document defines the intended combinations, semantics, and guidance for using evidence statuses in the dashboard.

---

## Core Types

### CheckStatus (Control Outcome)
Located in `artifacts/m365-dashboard/src/components/ChecklistTable.tsx`, represents the result of a security control assessment:
- **pass**: Control is configured as intended.
- **fail**: Control is not configured or is misconfigured.
- **warning**: Control is partially configured or in a transient state (e.g., "Report Only" mode).
- **manual**: Control requires manual review or is not automatically assessable.

### EvidenceStatus (Evidence Source)
Located in `lib/permissions-manifest/src/manifest.ts`, represents how the evidence was obtained:
- **apiBacked**: Evidence sourced directly from a Graph API endpoint or similar. Full programmatic visibility.
- **partial**: Evidence sourced from an API, but the control state is not fully observable. May require supplementary manual checks.
- **manual**: Evidence requires human assessment; no automated source is available.
- **automationCandidate**: Control is not yet automated but could be. A roadmap item for future automation.
- **notAssessed**: Control has not been evaluated in the current product version.

### ConfidenceLabel (Optional Evidence Quality)
Indicates confidence in the data quality or measurement:
- **high**: High confidence in the data accuracy. (Default; not shown on checklist rows.)
- **medium**: Moderate confidence; some uncertainty or inference involved.
- **low**: Low confidence; significant uncertainty or limited observability.
- **unknown**: Confidence level not determined.

---

## Intended Combinations

### (pass + apiBacked)
**Semantics**: Control is definitely configured; Graph API confirms it.
**Example**: "MFA enforced for all users" + Graph shows all users covered by MFA policy.

### (pass + partial)
**Semantics**: Control appears to be configured, but only partial API visibility.
**Example**: "DLP policies exist" + Graph shows DLP rules, but endpoint coverage can only be partially verified.

### (fail + apiBacked)
**Semantics**: Control is definitely not configured; API confirms it.
**Example**: "MFA enforced for all users" + Graph shows users not covered by MFA policy.

### (warning + apiBacked)
**Semantics**: Control is configured but in a non-enforcing state (e.g., report-only or audit mode).
**Example**: "Legacy authentication blocked" + Graph shows CA policy in Report Only mode.

### (warning + partial)
**Semantics**: Control is partially configured; API shows some signal but incomplete coverage.
**Example**: "MFA enforced for admins" + Graph shows policy covers some admin roles but not all.

### (manual + manual)
**Semantics**: Control is intentionally manual; no automated source exists yet.
**Example**: "Backup restoration has been tested" — requires human verification.

### (manual + automationCandidate)
**Semantics**: Control is manually assessed now but is a candidate for future automation.
**Example**: "SPF/DKIM/DMARC records set up" — could be automated via DNS/Exchange admin API in the future.

### (notAssessed + notAssessed)
**Semantics**: Control is not evaluated in the current product version.
**Example**: Deferred roadmap items not yet implemented.

### Anti-Patterns (Avoid)

- **(pass + manual)**: Contradictory. If a control is definitely configured, evidence must come from a source.
- **(fail + manual)**: Contradictory. If a control is definitely not configured, the API should have confirmed it.
- **(warning + manual)**: Unusual. Warning implies some observability; manual implies no source.
- **(apiBacked + automationCandidate)**: Contradictory. If evidence is API-backed, automation already exists.

---

## Using the Framework in Code

### For KPI Cards
```typescript
<KPICard
  title="Total Users"
  value={overview?.totalUsers}
  evidenceStatus={getMetricMeta("overview.totalUsers")?.evidenceStatus}  // e.g., "apiBacked"
  confidenceLabel={getMetricMeta("overview.totalUsers")?.confidenceLabel}  // e.g., "high"
/>
```

### For Checklist Items
```typescript
{
  label: "MFA is enforced for all users",
  status: hasMFAAllUsers ? "pass" : "fail",  // outcome
  evidenceStatus: "apiBacked",               // evidence source
  confidenceLabel: "high",                   // optional
  metricId: "users.checklist.1.1.mfaAllUsers",
  notes: "Sourced from Conditional Access policy Graph API.",
}
```

### Registry Entry Example
```typescript
{
  metricId: "users.checklist.1.1.mfaAllUsers",
  metricName: "MFA is enforced for all users",
  tab: "users",
  dataSources: [
    { provider: "microsoft-graph", endpoint: "/identity/conditionalAccess/policies", label: "Conditional Access Policies" }
  ],
  permissionDependencies: ["Policy.Read.All"],
  licenseDependencies: ["entra-id-p2-recommended"],
  confidenceLabel: "high",
  evidenceStatus: "apiBacked",
  notes: ["Derived from active CA policies covering all users with MFA requirement."],
}
```

---

## Adding New Checks: Decision Tree

1. **Is there an automated API or data source?**
   - **Yes, full observability**: Use `apiBacked` + `high` confidence.
   - **Yes, partial observability**: Use `partial` + `high` or `medium` confidence.
   - **No**: Go to step 2.

2. **Should this be automated in the future?**
   - **Yes**: Use `automationCandidate` + `manual` outcome (for now).
   - **No**: Use `manual` + `manual` outcome.

3. **Is this control evaluated in the current version?**
   - **Yes**: Use the appropriate status from step 1 or 2.
   - **No**: Use `notAssessed`.

---

## Permission Implications

- If a permission is **required** but **not granted**, the evidence status should degrade:
  - From `apiBacked` → `partial` (if fallback data exists), or
  - From `apiBacked` → `manual` (if no fallback exists).
  
- If a permission is **optional** and **not granted**, the assessment should:
  - Render as `partial` (partial visibility), with a note explaining the permission.

- **Example**: "Intune compliance %" is `apiBacked` if `IntuneConfiguration.Read.All` is granted, but becomes `partial` if only a subset of devices are visible, and `manual` if the permission is missing.

---

## Registry Naming Convention

For consistency, use this pattern for checklist metric IDs:

```
{tab}.checklist.{sectionId}.{itemIndex}
```

**Examples**:
- `users.checklist.1.1.mfaAllUsers` — Users tab, section 1.1, MFA for all users.
- `exchange.checklist.2.1.spf` — Exchange tab, section 2.1, SPF records.
- `teams-sharepoint.checklist.3.1.externalAccess` — Teams/SharePoint tab, section 3.1, external access.
- `compliance.checklist.7.2.auditLogging` — Compliance tab, section 7.2, audit logging.

---

## Future Work (Out of Sprint 0)

- **Per-field metadata**: Embedding evidence status in every API response payload.
- **Dynamic evidence derivation**: Rules engine for automatically computing evidence status based on runtime conditions.
- **Confidence scoring**: Automated calculation of confidence based on data freshness, permission availability, and API response completeness.
- **Evidence tracing**: Audit trail showing why a control was marked as `manual` or `partial` at a given time.
