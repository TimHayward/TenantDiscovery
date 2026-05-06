import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, XCircle, AlertTriangle, HelpCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getMetricDataSourceEntry, type ConfidenceLabel, type EvidenceStatus, type ManualCheckDefinition, type ManualReasonCode } from "@workspace/permissions-manifest";

/**
 * CheckStatus represents the outcome of a control assessment (pass/fail/warning/manual).
 * This is independent of EvidenceStatus, which describes how the evidence was obtained.
 */
export type CheckStatus = "pass" | "fail" | "warning" | "manual";

/**
 * ChecklistItem represents a single security control or assessment.
 * - status: outcome of the assessment (CheckStatus)
 * - evidenceStatus: how the evidence was obtained (from the five-label taxonomy)
 * - confidenceLabel: optional confidence in the evidence quality
 * - metricId/assessmentId: optional stable identifier for registry lookup
 * - sourceLabel: optional human-readable source of the data
 * - notes: optional explanation for manual, partial, or incomplete states
 */
export interface ChecklistItem {
  label: string;
  status: CheckStatus;
  detail?: string;
  evidenceStatus?: EvidenceStatus;
  confidenceLabel?: ConfidenceLabel;
  metricId?: string;
  assessmentId?: string;
  sourceLabel?: string;
  notes?: string;
  manualReasonCode?: ManualReasonCode;
  whyManual?: string;
  evidenceRequired?: string;
  futureAutomation?: ManualCheckDefinition["futureAutomation"];
  exceptionRationale?: string;
}

export interface ChecklistGroup {
  id: string;
  title: string;
  items: ChecklistItem[];
}

interface Props {
  sectionTitle: string;
  groups: ChecklistGroup[];
  loading?: boolean;
}

function StatusBadge({ status, detail }: { status: CheckStatus; detail?: string }) {
  const configs: Record<CheckStatus, { icon: typeof CheckCircle2; label: string; badgeCls: string; iconCls: string }> = {
    pass:    { icon: CheckCircle2, label: detail ?? "Configured",              badgeCls: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",      iconCls: "text-green-500" },
    fail:    { icon: XCircle,      label: detail ?? "Not Configured",          badgeCls: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",              iconCls: "text-red-500" },
    warning: { icon: AlertTriangle,label: detail ?? "Review Required",         badgeCls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",  iconCls: "text-yellow-500" },
    manual:  { icon: HelpCircle,   label: detail ?? "Manual Check Required",   badgeCls: "bg-muted text-muted-foreground",                                             iconCls: "text-muted-foreground" },
  };
  const { icon: Icon, label, badgeCls, iconCls } = configs[status];
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${iconCls}`} />
      <Badge className={`${badgeCls} font-normal text-xs border-0 whitespace-nowrap`}>{label}</Badge>
    </div>
  );
}

/**
 * EvidenceBadge renders the evidence status for a checklist item.
 * Provides a secondary badge showing how the evidence was obtained.
 */
function EvidenceBadge({ evidenceStatus, confidenceLabel, sourceLabel }: { evidenceStatus?: EvidenceStatus; confidenceLabel?: ConfidenceLabel; sourceLabel?: string }) {
  const EVIDENCE_LABELS: Record<EvidenceStatus, string> = {
    apiBacked: "API-backed",
    partial: "Partial",
    manual: "Manual",
    automationCandidate: "Automation candidate",
    notAssessed: "Not assessed",
  };

  const CONFIDENCE_LABELS: Record<ConfidenceLabel, string> = {
    high: "High confidence",
    medium: "Medium confidence",
    low: "Low confidence",
    unknown: "Unknown confidence",
  };

  if (!evidenceStatus && !confidenceLabel && !sourceLabel) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {evidenceStatus && (
        <Badge variant="outline" className="text-[10px] font-normal bg-slate-50 dark:bg-slate-900/30">
          {EVIDENCE_LABELS[evidenceStatus]}
        </Badge>
      )}
      {confidenceLabel && confidenceLabel !== "high" && (
        <Badge variant="outline" className="text-[10px] font-normal bg-slate-50 dark:bg-slate-900/30">
          {CONFIDENCE_LABELS[confidenceLabel]}
        </Badge>
      )}
      {sourceLabel && (
        <Badge variant="outline" className="text-[10px] font-normal bg-slate-50 dark:bg-slate-900/30">
          {sourceLabel}
        </Badge>
      )}
    </div>
  );
}

export function ChecklistTable({ sectionTitle, groups, loading }: Props) {
  const allItems = groups.flatMap(g => g.items);
  const passed   = allItems.filter(i => i.status === "pass").length;
  const failed   = allItems.filter(i => i.status === "fail").length;
  const warnings = allItems.filter(i => i.status === "warning").length;
  const manuals  = allItems.filter(i => i.status === "manual").length;

  const flatRows: Array<{ kind: "group"; group: ChecklistGroup } | { kind: "item"; groupId: string; item: ChecklistItem; idx: number }> = [];
  for (const g of groups) {
    flatRows.push({ kind: "group", group: g });
    g.items.forEach((item, idx) => flatRows.push({ kind: "item", groupId: g.id, item, idx }));
  }

  const resolveManualDetails = (item: ChecklistItem) => {
    if (!item.metricId) {
      return item;
    }

    const registryEntry = getMetricDataSourceEntry(item.metricId);
    const manual = registryEntry?.manualCheck;

    if (!manual) {
      return item;
    }

    return {
      ...item,
      manualReasonCode: item.manualReasonCode ?? manual.reasonCode,
      whyManual: item.whyManual ?? manual.whyManual,
      evidenceRequired: item.evidenceRequired ?? manual.evidenceRequired,
      futureAutomation: item.futureAutomation ?? manual.futureAutomation,
      exceptionRationale: item.exceptionRationale ?? manual.exceptionRationale,
      notes: item.notes ?? `Future automation: ${manual.futureAutomation.route}`,
    };
  };

  return (
    <div className="space-y-4 pt-2">
      <h2 className="text-xl font-semibold border-b pb-2">{sectionTitle} — Security Checklist</h2>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Passed",   value: passed,   color: "text-green-600 dark:text-green-400" },
          { label: "Failed",   value: failed,   color: "text-red-600 dark:text-red-400" },
          { label: "Review",   value: warnings, color: "text-yellow-600 dark:text-yellow-400" },
          { label: "Manual",   value: manuals,  color: "text-muted-foreground" },
        ].map(({ label, value, color }) => (
          <div key={label} className="p-3 border rounded-md bg-card text-center">
            <p className="text-xs text-muted-foreground">{label}</p>
            {loading
              ? <Skeleton className="h-8 w-12 mx-auto mt-1" />
              : <p className={`text-2xl font-bold mt-0.5 ${color}`}>{value}</p>
            }
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-2">
              {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Requirement</TableHead>
                  <TableHead className="w-[220px]">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {flatRows.map((row) => {
                  if (row.kind === "group") {
                    return (
                      <TableRow key={`grp-${row.group.id}`} className="bg-muted/40 hover:bg-muted/50">
                        <TableCell colSpan={2} className="py-2.5 pl-4 font-semibold text-sm">
                          {row.group.title}
                        </TableCell>
                      </TableRow>
                    );
                  }
                  return (
                    <TableRow key={`item-${row.groupId}-${row.idx}`}>
                      <TableCell className="pl-8 text-sm text-muted-foreground py-2.5">{row.item.label}</TableCell>
                      <TableCell className="py-2.5">
                        {(() => {
                          const resolved = resolveManualDetails(row.item);
                          return (
                        <div className="flex flex-col gap-1">
                          <StatusBadge status={resolved.status} detail={resolved.detail} />
                          <EvidenceBadge evidenceStatus={resolved.evidenceStatus} confidenceLabel={resolved.confidenceLabel} sourceLabel={resolved.sourceLabel} />
                          {resolved.whyManual && <p className="text-[10px] text-muted-foreground mt-0.5">Why manual: {resolved.whyManual}</p>}
                          {resolved.evidenceRequired && <p className="text-[10px] text-muted-foreground mt-0.5">Evidence: {resolved.evidenceRequired}</p>}
                          {resolved.futureAutomation?.route && <p className="text-[10px] text-muted-foreground italic mt-0.5">Future automation: {resolved.futureAutomation.route}</p>}
                          {resolved.notes && <p className="text-[10px] text-muted-foreground italic mt-0.5">{resolved.notes}</p>}
                        </div>
                          );
                        })()}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
