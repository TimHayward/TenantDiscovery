import React from "react";
import { useGetM365Intune } from "@workspace/api-client-react";
import { ChecklistTable, type ChecklistGroup } from "@/components/ChecklistTable";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { CSVLink } from "react-csv";
import {
  Download, ShieldCheck, ShieldAlert, Monitor, Smartphone,
  Apple, AlertTriangle, CheckCircle2, XCircle, Clock, Info, Search, X, ChevronDown,
} from "lucide-react";
import { useTheme } from "next-themes";
import { formatDate } from "@/lib/utils";
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  getFilteredRowModel, getPaginationRowModel, flexRender,
  type ColumnDef, type SortingState,
} from "@tanstack/react-table";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type {
  IntuneDeviceItem,
  IntunePolicyItem,
  IntuneAssessmentItem,
} from "@workspace/api-client-react/src/generated/api.schemas";

// ── palette ───────────────────────────────────────────────────────────────────

const C = {
  blue:   "#0079F2",
  purple: "#795EFF",
  green:  "#009118",
  red:    "#A60808",
  yellow: "#eab308",
  orange: "#f97316",
  gray:   "#9ca3af",
};

const OS_COLORS: Record<string, string> = {
  Windows:  C.blue,
  iOS:      C.purple,
  Android:  C.green,
  macOS:    C.orange,
  Unknown:  C.gray,
};

const COMPLIANCE_COLORS: Record<string, string> = {
  compliant:     C.green,
  noncompliant:  C.red,
  unknown:       C.gray,
  inGracePeriod: C.yellow,
  notApplicable: C.gray,
  error:         C.orange,
};

// ── helpers ───────────────────────────────────────────────────────────────────

function ExportBtn({ filename, csvData }: { filename: string; csvData: object[] }) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  if (!csvData.length) return null;
  return (
    <CSVLink
      data={csvData} filename={filename}
      className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80 flex-shrink-0"
      style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }}
      aria-label="Export CSV"
    >
      <Download className="w-3.5 h-3.5" />
    </CSVLink>
  );
}

function ComplianceBadge({ state }: { state: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    compliant:     { cls: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",   label: "Compliant" },
    noncompliant:  { cls: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",           label: "Non-compliant" },
    unknown:       { cls: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",          label: "Unknown" },
    inGracePeriod: { cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400", label: "Grace Period" },
    notApplicable: { cls: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",          label: "N/A" },
    error:         { cls: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400", label: "Error" },
  };
  const m = map[state] ?? { cls: "bg-muted text-muted-foreground", label: state };
  return <Badge className={`${m.cls} font-normal text-xs border-0`}>{m.label}</Badge>;
}

function PlatformBadge({ platform }: { platform: string }) {
  const color = OS_COLORS[platform] ?? C.gray;
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      <span className="text-sm">{platform}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    "Good":              "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    "Warning":           "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    "Critical":          "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    "Action Required":   "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    "Configured":        "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    "Not configured":    "bg-muted text-muted-foreground",
    "Active":            "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    "Enrolled":          "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
    "Monitor":           "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
    "N/A":               "bg-muted text-muted-foreground",
  };
  return (
    <Badge className={`${map[status] ?? "bg-muted text-muted-foreground"} font-normal text-xs border-0`}>
      {status}
    </Badge>
  );
}

function OSIcon({ os }: { os: string }) {
  const lower = os.toLowerCase();
  if (lower.includes("windows")) return <Monitor className="w-4 h-4 text-blue-500" />;
  if (lower.includes("ios"))     return <Smartphone className="w-4 h-4 text-purple-500" />;
  if (lower.includes("android")) return <Smartphone className="w-4 h-4 text-green-500" />;
  if (lower.includes("macos"))   return <Apple className="w-4 h-4 text-orange-500" />;
  return <Monitor className="w-4 h-4 text-muted-foreground" />;
}

// ── table column definitions ──────────────────────────────────────────────────

const deviceColumns: ColumnDef<IntuneDeviceItem>[] = [
  {
    accessorKey: "deviceName",
    header: "Device",
    cell: ({ row }) => (
      <div>
        <p className="font-medium text-sm">{row.original.deviceName}</p>
        <p className="text-xs text-muted-foreground">{row.original.model || row.original.manufacturer}</p>
      </div>
    ),
  },
  {
    accessorKey: "operatingSystem",
    header: "OS",
    cell: ({ row }) => (
      <div className="flex items-center gap-1.5">
        <OSIcon os={row.original.operatingSystem} />
        <div>
          <p className="text-sm">{row.original.operatingSystem}</p>
          <p className="text-xs text-muted-foreground">{row.original.osVersion}</p>
        </div>
      </div>
    ),
  },
  {
    accessorKey: "complianceState",
    header: "Compliance",
    cell: ({ row }) => <ComplianceBadge state={row.original.complianceState} />,
  },
  {
    accessorKey: "userDisplayName",
    header: "User",
    cell: ({ row }) => (
      <div>
        <p className="text-sm">{row.original.userDisplayName}</p>
        <p className="text-xs text-muted-foreground">{row.original.userPrincipalName}</p>
      </div>
    ),
  },
  {
    accessorKey: "isEncrypted",
    header: "Encrypted",
    cell: ({ row, table }) => {
      const excl = (table.options.meta as { excludedDeviceNames?: Set<string> })?.excludedDeviceNames?.has(row.original.deviceName);
      if (excl) return <span className="text-xs text-muted-foreground font-medium">N/A</span>;
      if (row.original.isEncrypted === null) return <span className="text-muted-foreground text-sm">—</span>;
      return row.original.isEncrypted
        ? <CheckCircle2 className="w-4 h-4 text-green-500" />
        : <XCircle className="w-4 h-4 text-red-500" />;
    },
  },
  {
    accessorKey: "lastSyncDateTime",
    header: "Last Sync",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">{formatDate(row.original.lastSyncDateTime) || "Never"}</span>
    ),
  },
  {
    accessorKey: "enrolledDateTime",
    header: "Enrolled",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">{formatDate(row.original.enrolledDateTime) || "Unknown"}</span>
    ),
  },
  {
    accessorKey: "jailBroken",
    header: "Jailbroken",
    cell: ({ row }) => {
      const val = row.original.jailBroken ?? "Unknown";
      const lower = val.toLowerCase();
      if (lower === "true") {
        return (
          <div className="flex items-center gap-1">
            <XCircle className="w-4 h-4 text-red-500" />
            <span className="text-xs font-medium text-red-600 dark:text-red-400">Yes</span>
          </div>
        );
      }
      if (lower === "false") {
        return (
          <div className="flex items-center gap-1">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span className="text-xs font-medium text-green-600 dark:text-green-400">No</span>
          </div>
        );
      }
      return <span className="text-xs text-muted-foreground">N/A</span>;
    },
  },
  {
    accessorKey: "managementAgent",
    header: "Agent",
    cell: ({ row }) => <span className="text-xs text-muted-foreground capitalize">{row.original.managementAgent}</span>,
  },
  {
    id: "expand",
    header: "",
    cell: ({ row, table }) => {
      const meta = table.options.meta as {
        expandedDeviceId?: string | null;
        setExpandedDeviceId?: (id: string | null) => void;
      };
      const canExpand = ["noncompliant", "inGracePeriod", "error"].includes(row.original.complianceState);
      if (!canExpand) return null;
      const isExpanded = meta.expandedDeviceId === row.original.id;
      return (
        <button
          onClick={(e) => {
            e.stopPropagation();
            meta.setExpandedDeviceId?.(isExpanded ? null : row.original.id);
          }}
          className="p-1 rounded hover:bg-muted transition-colors flex items-center justify-center"
          title="View compliance failure details"
        >
          <ChevronDown className={`w-4 h-4 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
        </button>
      );
    },
  },
];

const policyColumns: ColumnDef<IntunePolicyItem>[] = [
  {
    accessorKey: "displayName",
    header: "Policy Name",
    cell: ({ row }) => (
      <div>
        <p className="font-medium text-sm">{row.original.displayName}</p>
        {row.original.description && (
          <p className="text-xs text-muted-foreground truncate max-w-xs">{row.original.description}</p>
        )}
      </div>
    ),
  },
  {
    accessorKey: "platform",
    header: "Platform",
    cell: ({ row }) => <PlatformBadge platform={row.original.platform} />,
  },
  {
    accessorKey: "assignedGroups",
    header: "Assigned",
    cell: ({ row }) => (
      <span className="text-sm">{row.original.assignedGroups} group{row.original.assignedGroups !== 1 ? "s" : ""}</span>
    ),
  },
  {
    accessorKey: "lastModifiedDateTime",
    header: "Last Modified",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">{formatDate(row.original.lastModifiedDateTime) || "—"}</span>
    ),
  },
];

const assessmentColumns: ColumnDef<IntuneAssessmentItem>[] = [
  {
    accessorKey: "area",
    header: "Area",
    cell: ({ row }) => (
      <Badge variant="outline" className="font-normal text-xs">{row.original.area}</Badge>
    ),
  },
  {
    accessorKey: "item",
    header: "Assessment Item",
    cell: ({ row }) => <span className="font-medium text-sm">{row.original.item}</span>,
  },
  {
    accessorKey: "value",
    header: "Value",
    cell: ({ row }) => <span className="text-sm font-semibold">{row.original.value}</span>,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "notes",
    header: "Notes",
    cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.notes}</span>,
  },
];

// ── Compliance drill-down ──────────────────────────────────────────────────────

const SETTING_FRIENDLY: Record<string, string> = {
  osMinimumVersion:                                    "OS version too old (below minimum required)",
  osMaximumVersion:                                    "OS version above maximum allowed",
  mobileOsMinimumVersion:                              "Mobile OS version too old",
  mobileOsMaximumVersion:                              "Mobile OS version above maximum",
  bitLockerEnabled:                                    "BitLocker disk encryption not enabled",
  storageRequireDeviceEncryption:                      "Device encryption not enabled",
  storageRequireEncryption:                            "Storage encryption not enabled",
  passcodeRequired:                                    "Passcode not configured",
  passwordRequired:                                    "Password not configured",
  passcodeMinimumLength:                               "Passcode too short",
  passwordMinimumLength:                               "Password too short",
  passcodeMinutesOfInactivityBeforeLock:               "Screen lock timeout exceeds policy",
  passwordMinutesOfInactivityBeforeLock:               "Screen lock timeout exceeds policy",
  passcodeRequiredType:                                "Passcode complexity insufficient",
  passwordRequiredType:                                "Password complexity insufficient",
  passcodeBlockSimple:                                 "Simple passcodes must be blocked",
  activeFirewallRequired:                              "Firewall not active",
  antivirusRequired:                                   "Antivirus not configured or up to date",
  antispywareRequired:                                 "Anti-spyware not configured",
  defenderEnabled:                                     "Windows Defender not enabled",
  signatureOutOfDate:                                  "Defender signatures out of date",
  rtpEnabled:                                          "Real-time protection not enabled",
  secureBootEnabled:                                   "Secure Boot not enabled",
  codeIntegrityEnabled:                                "Code integrity not enabled",
  tpmRequired:                                         "TPM chip required but missing or disabled",
  securityBlockJailbrokenDevices:                      "Jailbroken or rooted device detected",
  deviceThreatProtectionEnabled:                       "Device threat protection not enabled",
  deviceThreatProtectionRequiredSecurityLevel:         "Threat protection security level insufficient",
  managedEmailProfileRequired:                         "Managed email profile missing",
  securityRequireVerifyApps:                           "App verification not enabled",
  securityRequireSafetyNetAttestationBasicIntegrity:   "SafetyNet basic integrity check failed",
  securityRequireSafetyNetAttestationCertifiedDevice:  "SafetyNet certified device check failed",
  securityPreventInstallAppsFromUnknownSources:        "Unknown app sources must be blocked",
  securityDisableUsbDebugging:                         "USB debugging must be disabled",
  earlyLaunchAntiMalwareDriverEnabled:                 "Early-launch anti-malware driver not enabled",
  windowsDefenderMalwareProtectionEnabled:             "Windows Defender malware protection not enabled",
};

function friendlySettingName(raw: string): string {
  if (!raw) return "";
  return SETTING_FRIENDLY[raw] ?? raw.replace(/([A-Z])/g, " $1").trim();
}

const GENERIC_ERRORS = new Set(["No error code", "Not applicable", "No error", ""]);

function isUsefulRule(rule: ComplianceRuleState): boolean {
  const hasName = !!rule.settingName;
  const hasDescription = !!rule.errorDescription && !GENERIC_ERRORS.has(rule.errorDescription);
  return hasName || hasDescription;
}

type ComplianceRuleState = { settingName: string; state: string; errorDescription: string };
type CompliancePolicyDetail = {
  policyId: string; policyName: string; platformType: string;
  state: string; lastReportedDateTime: string | null; failingRules: ComplianceRuleState[];
};
type ComplianceDetail = {
  deviceId: string; totalPolicies: number; nonCompliantPolicies: number;
  policies: CompliancePolicyDetail[];
};

function ComplianceDrillDownPanel({
  deviceId, deviceName,
}: {
  deviceId: string; deviceName: string;
}) {
  const [detail, setDetail] = useState<ComplianceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError(null);
    fetch(`/api/m365/intune/device/${encodeURIComponent(deviceId)}/compliance`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) { setDetail(d); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setFetchError(String(e.message)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [deviceId]);

  const NON_COMPLIANT = new Set(["noncompliant", "nonCompliant", "error"]);

  if (loading) {
    return (
      <div className="p-4 space-y-2 bg-red-50/20 dark:bg-red-950/10 border-t border-red-200 dark:border-red-900">
        <div className="flex items-center gap-2 mb-3">
          <ShieldAlert className="w-4 h-4 text-red-400" />
          <span className="text-sm font-medium text-muted-foreground">Loading compliance details for {deviceName}…</span>
        </div>
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="p-4 text-sm text-red-600 dark:text-red-400 bg-red-50/20 dark:bg-red-950/10 border-t border-red-200 dark:border-red-900">
        Failed to load compliance details: {fetchError}
      </div>
    );
  }

  if (!detail || detail.policies.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground bg-muted/10 border-t">
        No compliance policies found for this device.
      </div>
    );
  }

  const failingPolicies = detail.policies.filter((p) => NON_COMPLIANT.has(p.state));
  const passingPolicies = detail.policies.filter((p) => !NON_COMPLIANT.has(p.state));

  return (
    <div className="bg-red-50/30 dark:bg-red-950/10 border-t border-red-200 dark:border-red-900 px-4 py-3 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 text-red-500 flex-shrink-0" />
        <span className="text-sm font-semibold">Compliance Failures — {deviceName}</span>
        <span className="text-xs text-muted-foreground">
          ({failingPolicies.length} of {detail.totalPolicies} polic{detail.totalPolicies !== 1 ? "ies" : "y"} failing)
        </span>
      </div>

      {/* Failing policies */}
      {failingPolicies.map((policy) => (
        <div
          key={policy.policyId}
          className="rounded-md border border-red-200 dark:border-red-800 bg-white dark:bg-red-950/20 overflow-hidden"
        >
          <div className="px-3 py-2 bg-red-100/70 dark:bg-red-900/30 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <span className="font-medium text-sm truncate">{policy.policyName}</span>
              {policy.platformType && policy.platformType !== "unknown" && (
                <Badge variant="outline" className="text-xs font-normal border-red-300 dark:border-red-700 shrink-0">
                  {policy.platformType}
                </Badge>
              )}
            </div>
            {policy.lastReportedDateTime && (
              <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                {formatDate(policy.lastReportedDateTime)}
              </span>
            )}
          </div>

          {(() => {
            const useful = policy.failingRules.filter(isUsefulRule);
            return useful.length > 0 ? (
              <ul className="divide-y divide-red-100 dark:divide-red-900/30">
                {useful.map((rule, idx) => {
                  const label = rule.settingName
                    ? friendlySettingName(rule.settingName)
                    : rule.errorDescription;
                  const secondary = rule.settingName && !GENERIC_ERRORS.has(rule.errorDescription)
                    ? rule.errorDescription
                    : null;
                  return (
                    <li key={idx} className="px-3 py-2 flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400 mt-0.5 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{label}</p>
                        {secondary && (
                          <p className="text-xs text-muted-foreground mt-0.5">{secondary}</p>
                        )}
                        {rule.settingName && (
                          <p className="text-xs text-muted-foreground/50 font-mono mt-0.5">{rule.settingName}</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-3 py-2 text-xs text-muted-foreground italic">
                Specific rule details not available — device may lack an assigned compliance policy or Graph API doesn{"'"}t expose rule-level data for this policy type.
              </p>
            );
          })()}
        </div>
      ))}

      {/* Passing policies summary */}
      {passingPolicies.length > 0 && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0 mt-0.5" />
          <span>
            {passingPolicies.length} polic{passingPolicies.length !== 1 ? "ies" : "y"} passing:{" "}
            {passingPolicies.map((p) => p.policyName).join(", ")}
          </span>
        </div>
      )}
    </div>
  );
}

// ── component ─────────────────────────────────────────────────────────────────

export function IntuneTab() {
  const { data, isLoading, isFetching } = useGetM365Intune();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const loading = isLoading || isFetching;

  // ── AVD & Windows 365 encryption exclusions ────────────────────────────────
  const [avdGroupId, setAvdGroupIdState] = useState<string>(() => localStorage.getItem("avdGroupId") ?? "");
  const [avdGroupName, setAvdGroupNameState] = useState<string>(() => localStorage.getItem("avdGroupName") ?? "");
  const [avdGroupSearch, setAvdGroupSearch] = useState("");
  const [groups, setGroups] = useState<Array<{ id: string; displayName: string; description?: string }>>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupDeviceNames, setGroupDeviceNames] = useState<Set<string>>(new Set());
  const [groupMembersLoading, setGroupMembersLoading] = useState(false);
  const [showGroupDropdown, setShowGroupDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const setAvdGroupId = useCallback((id: string, name: string) => {
    setAvdGroupIdState(id);
    setAvdGroupNameState(name);
    localStorage.setItem("avdGroupId", id);
    localStorage.setItem("avdGroupName", name);
  }, []);

  const fetchGroups = useCallback(async (q: string) => {
    setGroupsLoading(true);
    try {
      const resp = await fetch(`/api/m365/groups?q=${encodeURIComponent(q)}`);
      if (resp.ok) {
        const d = await resp.json();
        setGroups(d.groups ?? []);
      }
    } finally {
      setGroupsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!avdGroupId) { setGroupDeviceNames(new Set()); return; }
    setGroupMembersLoading(true);
    fetch(`/api/m365/groups/${encodeURIComponent(avdGroupId)}/device-members`)
      .then((r) => r.json())
      .then((d) => setGroupDeviceNames(new Set<string>(d.deviceNames ?? [])))
      .catch(() => setGroupDeviceNames(new Set()))
      .finally(() => setGroupMembersLoading(false));
  }, [avdGroupId]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowGroupDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Windows 365 Cloud PCs — auto-detected by model name
  const win365DeviceNames = useMemo(
    () => new Set((data?.deviceList ?? []).filter((d) => d.model?.toLowerCase().startsWith("cloud pc")).map((d) => d.deviceName)),
    [data]
  );

  // All devices excluded from encryption calculation (Win365 + selected AVD group)
  const excludedDeviceNames = useMemo(
    () => new Set([...win365DeviceNames, ...groupDeviceNames]),
    [win365DeviceNames, groupDeviceNames]
  );

  // Adjusted encryption stats (excluding Win365 + AVD devices)
  const { adjustedTotal, adjustedEncrypted, adjustedPercent } = useMemo(() => {
    const deviceList = data?.deviceList ?? [];
    if (deviceList.length === 0) {
      return {
        adjustedTotal: data?.totalDevices ?? 0,
        adjustedEncrypted: data?.encryptedDevices ?? 0,
        adjustedPercent: data?.encryptionPercent ?? 0,
      };
    }
    const eligible = deviceList.filter((d) => !excludedDeviceNames.has(d.deviceName));
    const encCount = eligible.filter((d) => d.isEncrypted).length;
    const pct = eligible.length > 0 ? Math.round((encCount / eligible.length) * 100) : 0;
    return { adjustedTotal: eligible.length, adjustedEncrypted: encCount, adjustedPercent: pct };
  }, [data, excludedDeviceNames]);

  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "#e5e5e5";
  const tickColor = isDark ? "#98999C" : "#71717a";

  // ── Section 4: Intune security checklist ────────────────────────────────────
  const intuneChecklist: ChecklistGroup[] = [
    { id: "4.1", title: "4.1 Automated patching is performed on all devices", items: [
      { label: "Windows Update Rings / patching policies configured",
        status: (data?.totalConfigProfiles ?? 0) > 0 ? "pass" : "fail",
        detail: (data?.totalConfigProfiles ?? 0) > 0 ? `${data?.totalConfigProfiles} config profiles` : "Not Configured" },
      { label: "Apple device update policies configured", status: "manual" },
    ]},
    { id: "4.2", title: "4.2 Managed devices are enrolled in MDM", items: [
      { label: "Devices enrolled in Microsoft Intune",
        status: (data?.totalDevices ?? 0) > 0 ? "pass" : "fail",
        detail: (data?.totalDevices ?? 0) > 0 ? `${data?.totalDevices} devices enrolled` : "No devices enrolled" },
    ]},
    { id: "4.3", title: "4.3 Personal Devices should be restricted from enrolling into the MDM solution", items: [
      { label: "Personal device enrollment restricted", status: "manual" },
    ]},
    { id: "4.4", title: "4.4 Security Baselines should be configured for Windows Devices", items: [
      { label: "Windows security baselines configured",
        status: (data?.totalConfigProfiles ?? 0) > 0 ? "warning" : "fail",
        detail: (data?.totalConfigProfiles ?? 0) > 0 ? `${data?.totalConfigProfiles} config profiles (verify baselines included)` : "Not Configured" },
    ]},
    { id: "4.5", title: "4.5 Device compliance policies shall be configured for every supported device platform", items: [
      { label: "Compliance policies configured for each device platform",
        status: (data?.totalCompliancePolicies ?? 0) > 0 ? "pass" : "fail",
        detail: (data?.totalCompliancePolicies ?? 0) > 0 ? `${data?.totalCompliancePolicies} policies configured` : "Not Configured" },
    ]},
    { id: "4.6", title: "4.6 All devices have drive encryption applied", items: [
      { label: "Drive encryption applied to all enrolled devices (excludes Win365/AVD)",
        status: adjustedEncrypted === adjustedTotal && adjustedTotal > 0 ? "pass" : adjustedPercent >= 80 ? "warning" : "fail",
        detail: `${adjustedEncrypted} of ${adjustedTotal} eligible devices encrypted (${adjustedPercent}%)` },
    ]},
    { id: "4.7", title: "4.7 Lockout screen and password settings shall be configured for each device", items: [
      { label: "Lockout and password policies deployed to all device platforms", status: "manual" },
    ]},
    { id: "4.8", title: "4.8 App Protection policies should be created for mobile devices", items: [
      { label: "App protection policies configured for mobile devices",
        status: (data?.totalAppProtectionPolicies ?? 0) > 0 ? "pass" : "fail",
        detail: (data?.totalAppProtectionPolicies ?? 0) > 0 ? `${data?.totalAppProtectionPolicies} policies configured` : "Not Configured" },
    ]},
    { id: "4.9", title: "4.9 Approved 3rd party applications are deployed and patched", items: [
      { label: "Approved 3rd party applications managed and patched via Intune", status: "manual" },
    ]},
    { id: "4.10", title: "4.10 Local Administrators passwords are managed with LAPS", items: [
      { label: "LAPS configured for local administrator password management", status: "manual" },
    ]},
  ];

  // ── derived chart data ──
  const enrolledByOSChart = useMemo(
    () => (data?.enrolledByOS ?? []).map((e) => ({ name: e.os, value: e.count, color: OS_COLORS[e.os] ?? C.gray })),
    [data]
  );

  const complianceByStateChart = useMemo(
    () => (data?.complianceByState ?? []).map((c) => ({
      name: c.state.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()),
      value: c.count,
      color: COMPLIANCE_COLORS[c.state] ?? C.gray,
    })),
    [data]
  );

  const complianceByOSChart = useMemo(
    () => (data?.complianceByOS ?? []).map((c) => ({
      os: c.os,
      Compliant: c.compliant,
      NonCompliant: c.nonCompliant,
    })),
    [data]
  );

  // ── table states ──
  const [deviceFilter, setDeviceFilter] = useState("");
  const [deviceSorting, setDeviceSorting] = useState<SortingState>([{ id: "complianceState", desc: true }]);
  const [deviceOsFilter, setDeviceOsFilter] = useState<string>("all");
  const [expandedDeviceId, setExpandedDeviceId] = useState<string | null>(null);

  const [policyTab, setPolicyTab] = useState<"compliance" | "config" | "app">("compliance");
  const [policySorting, setPolicySorting] = useState<SortingState>([{ id: "platform", desc: false }]);

  const [assessmentSorting, setAssessmentSorting] = useState<SortingState>([{ id: "area", desc: false }]);

  // Filter devices
  const filteredDevices = useMemo(() => {
    const list = data?.deviceList ?? [];
    return deviceOsFilter === "all" ? list : list.filter((d) => d.operatingSystem === deviceOsFilter);
  }, [data, deviceOsFilter]);

  const deviceTable = useReactTable({
    data: filteredDevices,
    columns: deviceColumns,
    state: { sorting: deviceSorting, globalFilter: deviceFilter },
    onSortingChange: setDeviceSorting,
    onGlobalFilterChange: setDeviceFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 20 } },
    meta: { excludedDeviceNames, expandedDeviceId, setExpandedDeviceId },
  });

  const activePolicies: IntunePolicyItem[] = useMemo(() => {
    if (policyTab === "compliance") return data?.compliancePoliciesList ?? [];
    if (policyTab === "config") return data?.configProfilesList ?? [];
    return data?.appProtectionList ?? [];
  }, [data, policyTab]);

  const policyTable = useReactTable({
    data: activePolicies,
    columns: policyColumns,
    state: { sorting: policySorting },
    onSortingChange: setPolicySorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 15 } },
  });

  const assessmentTable = useReactTable({
    data: data?.assessmentItems ?? [],
    columns: assessmentColumns,
    state: { sorting: assessmentSorting },
    onSortingChange: setAssessmentSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  // Unique OS options for device filter
  const osOptions = useMemo(
    () => [...new Set((data?.deviceList ?? []).map((d) => d.operatingSystem))],
    [data]
  );

  if (!loading && data?.permissionRequired) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <ShieldAlert className="w-14 h-14 text-muted-foreground" />
        <div>
          <p className="text-lg font-semibold">Intune Permissions Required</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            No enrolled devices were returned. Grant the following Microsoft Graph application permissions to
            your Azure app registration, then refresh.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 justify-center mt-2">
          {["DeviceManagementManagedDevices.Read.All", "DeviceManagementConfiguration.Read.All"].map((p) => (
            <code key={p} className="bg-muted px-2 py-1 rounded text-xs">{p}</code>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── Device list unavailable notice ──────────────────────────────────── */}
      {!loading && data && !data.deviceListAvailable && (
        <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800 px-4 py-3">
          <Info className="w-4 h-4 mt-0.5 text-blue-500 flex-shrink-0" />
          <div className="text-sm text-blue-700 dark:text-blue-300">
            <span className="font-semibold">Partial data — per-device details unavailable.</span>{" "}
            Compliance summaries, policies, and profiles are loaded from available permissions. To enable the full device list, grant{" "}
            <code className="bg-blue-100 dark:bg-blue-900 px-1 rounded text-xs">DeviceManagementManagedDevices.Read.All</code>{" "}
            on your Azure app registration and refresh.
          </div>
        </div>
      )}

      {/* ── KPIs ────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KPICard title="Total Devices"       value={data?.totalDevices}               loading={loading} />
        <KPICard title="Compliant"           value={data?.compliantDevices}            loading={loading} valueColor={C.green} />
        <KPICard title="Non-Compliant"       value={data?.nonCompliantDevices}         loading={loading} valueColor={data && data.nonCompliantDevices > 0 ? C.red : C.green} />
        <KPICard title="Compliance %"        value={data ? `${data.overallCompliancePercent}%` : undefined} loading={loading} valueColor={data && data.overallCompliancePercent < 80 ? C.red : C.green} />
        <KPICard title="Compliance Policies" value={data?.totalCompliancePolicies}     loading={loading} />
        <KPICard title="Config Profiles"     value={data?.totalConfigProfiles}         loading={loading} />
      </div>

      {/* ── Enrolled by OS + Compliance by state ─────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Enrolled Devices by Platform</CardTitle>
            <ExportBtn filename="enrolled-by-os.csv" csvData={data?.enrolledByOS ?? []} />
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="w-full h-[240px]" /> : enrolledByOSChart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[220px] gap-2 text-center">
                <Info className="w-8 h-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">Per-device OS breakdown unavailable</p>
                <p className="text-xs text-muted-foreground/70">Requires <code className="bg-muted px-1 rounded">DeviceManagementManagedDevices.Read.All</code></p>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={220} debounce={0}>
                  <PieChart>
                    <Pie
                      data={enrolledByOSChart} dataKey="value" nameKey="name"
                      cx="50%" cy="50%" innerRadius={55} outerRadius={90}
                      cornerRadius={2} paddingAngle={2} isAnimationActive={false} stroke="none"
                    >
                      {enrolledByOSChart.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip isAnimationActive={false} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap justify-center gap-4 mt-1">
                  {enrolledByOSChart.map((entry) => (
                    <div key={entry.name} className="flex items-center gap-2 text-sm">
                      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: entry.color }} />
                      <span className="text-muted-foreground">{entry.name}</span>
                      <span className="font-semibold">{entry.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Overall Compliance by State</CardTitle>
            <ExportBtn filename="compliance-by-state.csv" csvData={data?.complianceByState ?? []} />
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="w-full h-[240px]" /> : (
              <div className="flex flex-col items-center">
                <ResponsiveContainer width="100%" height={220} debounce={0}>
                  <PieChart>
                    <Pie
                      data={complianceByStateChart} dataKey="value" nameKey="name"
                      cx="50%" cy="50%" innerRadius={55} outerRadius={90}
                      cornerRadius={2} paddingAngle={2} isAnimationActive={false} stroke="none"
                    >
                      {complianceByStateChart.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip isAnimationActive={false} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap justify-center gap-4 mt-1">
                  {complianceByStateChart.map((entry) => (
                    <div key={entry.name} className="flex items-center gap-2 text-sm">
                      <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: entry.color }} />
                      <span className="text-muted-foreground">{entry.name}</span>
                      <span className="font-semibold">{entry.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Compliance by OS + OS version breakdown ───────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Compliance by Platform</CardTitle>
            <ExportBtn filename="compliance-by-os.csv" csvData={data?.complianceByOS ?? []} />
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="w-full h-[220px]" /> : complianceByOSChart.length === 0 ? (
              <div className="flex items-center justify-center h-[220px] text-muted-foreground text-sm">No device data</div>
            ) : (
              <ResponsiveContainer width="100%" height={220} debounce={0}>
                <BarChart data={complianceByOSChart} margin={{ left: -20, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="os" tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: tickColor }} stroke={tickColor} />
                  <Tooltip isAnimationActive={false} />
                  <Legend />
                  <Bar dataKey="Compliant"    fill={C.green} fillOpacity={0.85} radius={[2, 2, 0, 0]} isAnimationActive={false} stackId="a" />
                  <Bar dataKey="NonCompliant" fill={C.red}   fillOpacity={0.85} radius={[2, 2, 0, 0]} isAnimationActive={false} stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">OS Version Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
            ) : (data?.osVersionBreakdown ?? []).length === 0 ? (
              <div className="flex items-center justify-center h-[180px] text-muted-foreground text-sm">No data</div>
            ) : (
              <div className="space-y-3 max-h-[240px] overflow-y-auto pr-1">
                {(data?.osVersionBreakdown ?? []).map(({ os, versions }) => (
                  <div key={os}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <OSIcon os={os} />
                      <span className="text-sm font-semibold">{os}</span>
                    </div>
                    <div className="space-y-1 pl-5">
                      {versions.slice(0, 6).map(({ version, count }) => (
                        <div key={version} className="flex items-center gap-3">
                          <div className="flex-1 h-4 rounded overflow-hidden bg-muted">
                            <div
                              className="h-full rounded transition-all"
                              style={{
                                width: `${Math.max(8, (count / (versions[0]?.count || 1)) * 100)}%`,
                                backgroundColor: OS_COLORS[os] ?? C.gray,
                                opacity: 0.8,
                              }}
                            />
                          </div>
                          <span className="text-xs text-muted-foreground w-20 truncate shrink-0">{version}</span>
                          <span className="text-xs font-semibold w-5 text-right shrink-0">{count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Security highlights row ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-l-4" style={{ borderLeftColor: adjustedPercent >= 90 ? C.green : C.yellow }}>
          <CardContent className="pt-4 pb-3 px-4 flex items-start gap-3">
            <ShieldCheck className="w-8 h-8 mt-0.5 flex-shrink-0" style={{ color: adjustedPercent >= 90 ? C.green : C.yellow }} />
            <div>
              <p className="text-sm font-semibold">Device Encryption</p>
              <p className="text-2xl font-bold mt-0.5">{loading ? "—" : `${adjustedPercent}%`}</p>
              <p className="text-xs text-muted-foreground">
                {loading ? "" : `${adjustedEncrypted} of ${adjustedTotal} eligible devices encrypted`}
                {!loading && excludedDeviceNames.size > 0 && (
                  <span className="ml-1 opacity-70">({excludedDeviceNames.size} N/A excluded)</span>
                )}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4" style={{ borderLeftColor: data?.jailbrokenCount === 0 ? C.green : C.red }}>
          <CardContent className="pt-4 pb-3 px-4 flex items-start gap-3">
            <AlertTriangle className="w-8 h-8 mt-0.5 flex-shrink-0" style={{ color: data?.jailbrokenCount === 0 ? C.green : C.red }} />
            <div>
              <p className="text-sm font-semibold">Jailbroken / Rooted</p>
              <p className="text-2xl font-bold mt-0.5">{loading ? "—" : (data?.jailbrokenCount ?? 0)}</p>
              <p className="text-xs text-muted-foreground">
                {loading ? "" : data?.jailbrokenCount === 0 ? "No compromised devices detected" : "Compromised devices require immediate action"}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4" style={{ borderLeftColor: C.purple }}>
          <CardContent className="pt-4 pb-3 px-4 flex items-start gap-3">
            <Clock className="w-8 h-8 mt-0.5 flex-shrink-0" style={{ color: C.purple }} />
            <div>
              <p className="text-sm font-semibold">App Protection Policies</p>
              <p className="text-2xl font-bold mt-0.5">{loading ? "—" : (data?.totalAppProtectionPolicies ?? 0)}</p>
              <p className="text-xs text-muted-foreground">MAM policies protecting app data</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Policy summary per device type ───────────────────────────────── */}
      <Card>
        <CardHeader className="px-4 pt-4 pb-2 flex-row items-start justify-between space-y-0 gap-4 flex-wrap">
          <div>
            <CardTitle className="text-base">Policy Summary</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Compliance policies, configuration profiles, and app protection policies</p>
          </div>
          <div className="flex gap-1 flex-wrap">
            {(["compliance", "config", "app"] as const).map((t) => {
              const labels = { compliance: "Compliance", config: "Config Profiles", app: "App Protection" };
              const counts = { compliance: data?.totalCompliancePolicies ?? 0, config: data?.totalConfigProfiles ?? 0, app: data?.totalAppProtectionPolicies ?? 0 };
              return (
                <button
                  key={t}
                  onClick={() => setPolicyTab(t)}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${policyTab === t ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border text-muted-foreground"}`}
                >
                  {labels[t]} ({counts[t]})
                </button>
              );
            })}
          </div>
          <ExportBtn filename={`${policyTab}-policies.csv`} csvData={activePolicies.map((p) => ({
            Name: p.displayName, Platform: p.platform, "Assigned Groups": p.assignedGroups,
            Description: p.description, "Last Modified": p.lastModifiedDateTime ?? "",
          }))} />
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : activePolicies.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground text-sm">
              <ShieldAlert className="w-8 h-8" />
              <p>No {policyTab === "compliance" ? "compliance policies" : policyTab === "config" ? "configuration profiles" : "app protection policies"} found.</p>
              {policyTab === "app" && (
                <p className="text-xs max-w-sm text-center">App protection policies require the
                  <code className="bg-muted px-1 rounded mx-1">DeviceManagementApps.Read.All</code> permission.</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    {policyTable.getHeaderGroups().map((hg) => (
                      <TableRow key={hg.id}>
                        {hg.headers.map((header) => (
                          <TableHead key={header.id} onClick={header.column.getToggleSortingHandler()} className="cursor-pointer select-none whitespace-nowrap">
                            <div className="flex items-center gap-1">
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {{ asc: " ↑", desc: " ↓" }[header.column.getIsSorted() as string] ?? null}
                            </div>
                          </TableHead>
                        ))}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {policyTable.getRowModel().rows.map((row) => (
                      <TableRow key={row.id}>
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id} className="py-2 align-top">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {policyTable.getFilteredRowModel().rows.length} polic{policyTable.getFilteredRowModel().rows.length !== 1 ? "ies" : "y"}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => policyTable.previousPage()} disabled={!policyTable.getCanPreviousPage()}>Previous</Button>
                  <Button variant="outline" size="sm" onClick={() => policyTable.nextPage()} disabled={!policyTable.getCanNextPage()}>Next</Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Enrolled Device List ──────────────────────────────────────────── */}
      <Card>
        <CardHeader className="px-4 pt-4 pb-2 flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              Enrolled Devices
              {!loading && <Badge variant="outline" className="font-normal text-xs">{data?.totalDevices ?? 0} total</Badge>}
            </CardTitle>
            {!loading && deviceOsFilter !== "all" && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Filtered: {deviceOsFilter} ({filteredDevices.length} devices) ·{" "}
                <button onClick={() => setDeviceOsFilter("all")} className="underline hover:text-foreground transition-colors">Show all</button>
              </p>
            )}
          </div>
          <ExportBtn filename="enrolled-devices.csv" csvData={(data?.deviceList ?? []).map((d) => ({
            Name: d.deviceName, OS: d.operatingSystem, Version: d.osVersion,
            Compliance: d.complianceState, User: d.userDisplayName, UPN: d.userPrincipalName,
            Encrypted: d.isEncrypted, Supervised: d.isSupervised, JailBroken: d.jailBroken,
            Model: d.model, Manufacturer: d.manufacturer, "Last Sync": d.lastSyncDateTime ?? "",
            Enrolled: d.enrolledDateTime ?? "",
          }))} />
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-80" />
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : !data?.deviceListAvailable ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              <Info className="w-10 h-10 text-blue-400" />
              <p className="font-medium">Per-device list requires additional permissions</p>
              <p className="text-sm text-muted-foreground max-w-sm">
                {(data?.totalDevices ?? 0) > 0
                  ? `${data!.totalDevices} devices detected via compliance summary (${data!.compliantDevices} compliant / ${data!.nonCompliantDevices} non-compliant).`
                  : ""}{" "}
                Grant <code className="bg-muted px-1 rounded">DeviceManagementManagedDevices.Read.All</code> to see individual device details.
              </p>
            </div>
          ) : (
            <div className="space-y-3">

              {/* ── AVD / Windows 365 Exclusion Selector ─────────────────── */}
              <div className="rounded-md border border-dashed bg-muted/20 px-3 py-2.5 space-y-2">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    <ShieldCheck className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Encryption Exclusions</p>
                      <p className="text-xs text-muted-foreground truncate">
                        Windows 365 auto-detected ({win365DeviceNames.size})
                        {avdGroupId && ` · AVD: ${avdGroupName} (${groupMembersLoading ? "…" : groupDeviceNames.size})`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0" ref={dropdownRef}>
                    {avdGroupId && (
                      <div className="flex items-center gap-1.5 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-full px-2.5 py-0.5">
                        <span className="text-xs font-medium text-blue-700 dark:text-blue-300 max-w-[160px] truncate">{avdGroupName}</span>
                        <button
                          onClick={() => setAvdGroupId("", "")}
                          className="text-blue-400 hover:text-blue-600 transition-colors ml-0.5"
                          title="Clear AVD group"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                    <div className="relative">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs h-7"
                        onClick={() => {
                          setShowGroupDropdown((v) => !v);
                          if (!showGroupDropdown && groups.length === 0) fetchGroups("");
                        }}
                      >
                        {avdGroupId ? "Change AVD Group" : "Select AVD Group"}
                      </Button>
                      {showGroupDropdown && (
                        <div className="absolute right-0 top-full mt-1 z-50 w-72 bg-popover border rounded-md shadow-lg p-2 space-y-2">
                          <div className="relative">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                            <input
                              autoFocus
                              className="w-full pl-7 pr-3 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                              placeholder="Search groups…"
                              value={avdGroupSearch}
                              onChange={(e) => {
                                setAvdGroupSearch(e.target.value);
                                fetchGroups(e.target.value);
                              }}
                            />
                          </div>
                          <div className="max-h-52 overflow-y-auto space-y-0.5">
                            {groupsLoading ? (
                              <p className="text-xs text-muted-foreground text-center py-4">Loading groups…</p>
                            ) : groups.length === 0 ? (
                              <p className="text-xs text-muted-foreground text-center py-4">No groups found</p>
                            ) : groups.map((g) => (
                              <button
                                key={g.id}
                                className={`w-full text-left px-2 py-1.5 rounded-sm text-sm hover:bg-muted transition-colors ${g.id === avdGroupId ? "bg-muted font-medium" : ""}`}
                                onClick={() => { setAvdGroupId(g.id, g.displayName); setShowGroupDropdown(false); }}
                              >
                                <p className="truncate">{g.displayName}</p>
                                {g.description && <p className="text-xs text-muted-foreground truncate">{g.description}</p>}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {excludedDeviceNames.size > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Info className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>
                      {excludedDeviceNames.size} device{excludedDeviceNames.size !== 1 ? "s" : ""} excluded from encryption stats — shown as N/A in the table below
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <Input
                  placeholder="Search devices, users…"
                  value={deviceFilter}
                  onChange={(e) => setDeviceFilter(e.target.value)}
                  className="max-w-xs"
                />
                <div className="flex gap-2 flex-wrap">
                  {["all", ...osOptions].map((os) => (
                    <button
                      key={os}
                      onClick={() => setDeviceOsFilter(os)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${deviceOsFilter === os ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border text-muted-foreground"}`}
                    >
                      {os === "all" ? `All (${data?.totalDevices ?? 0})` : `${os} (${data?.enrolledByOS?.find((e) => e.os === os)?.count ?? 0})`}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    {deviceTable.getHeaderGroups().map((hg) => (
                      <TableRow key={hg.id}>
                        {hg.headers.map((header) => (
                          <TableHead key={header.id} onClick={header.column.getToggleSortingHandler()} className="cursor-pointer select-none whitespace-nowrap">
                            <div className="flex items-center gap-1">
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {{ asc: " ↑", desc: " ↓" }[header.column.getIsSorted() as string] ?? null}
                            </div>
                          </TableHead>
                        ))}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {deviceTable.getRowModel().rows.length > 0 ? (
                      deviceTable.getRowModel().rows.map((row) => (
                        <React.Fragment key={row.id}>
                          <TableRow
                            className={
                              row.original.complianceState === "noncompliant"
                                ? "bg-red-50/40 dark:bg-red-950/10"
                                : row.original.complianceState === "inGracePeriod"
                                ? "bg-yellow-50/40 dark:bg-yellow-950/10"
                                : ""
                            }
                          >
                            {row.getVisibleCells().map((cell) => (
                              <TableCell key={cell.id} className="py-2 align-top">
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </TableCell>
                            ))}
                          </TableRow>
                          {expandedDeviceId === row.original.id && (
                            <TableRow className="hover:bg-transparent">
                              <TableCell colSpan={deviceColumns.length} className="p-0">
                                <ComplianceDrillDownPanel
                                  deviceId={row.original.id}
                                  deviceName={row.original.deviceName}
                                />
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={deviceColumns.length} className="h-16 text-center text-muted-foreground">
                          No devices match the filter.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Showing{" "}
                  {deviceTable.getState().pagination.pageIndex * deviceTable.getState().pagination.pageSize + (deviceTable.getFilteredRowModel().rows.length > 0 ? 1 : 0)}{" "}
                  –{" "}
                  {Math.min(
                    (deviceTable.getState().pagination.pageIndex + 1) * deviceTable.getState().pagination.pageSize,
                    deviceTable.getFilteredRowModel().rows.length
                  )}{" "}
                  of {deviceTable.getFilteredRowModel().rows.length}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => deviceTable.previousPage()} disabled={!deviceTable.getCanPreviousPage()}>Previous</Button>
                  <Button variant="outline" size="sm" onClick={() => deviceTable.nextPage()} disabled={!deviceTable.getCanNextPage()}>Next</Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 4 — INTUNE ASSESSMENT TABLE (matches PDF report format)      */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      <div className="space-y-3 pt-2">
        <div className="border-b pb-2 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Section 4 — Intune Assessment</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Comprehensive evaluation of device management posture across all Intune areas
            </p>
          </div>
          <ExportBtn filename="intune-assessment-section4.csv" csvData={(data?.assessmentItems ?? []).map((i) => ({
            Area: i.area, Item: i.item, Value: i.value, Status: i.status, Notes: i.notes,
          }))} />
        </div>

        <Card>
          <CardContent className="pt-4 px-0 pb-0">
            {loading ? (
              <div className="space-y-2 px-4 pb-4">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    {assessmentTable.getHeaderGroups().map((hg) => (
                      <TableRow key={hg.id}>
                        {hg.headers.map((header) => (
                          <TableHead key={header.id} onClick={header.column.getToggleSortingHandler()} className="cursor-pointer select-none whitespace-nowrap first:pl-6 last:pr-6">
                            <div className="flex items-center gap-1">
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {{ asc: " ↑", desc: " ↓" }[header.column.getIsSorted() as string] ?? null}
                            </div>
                          </TableHead>
                        ))}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {assessmentTable.getRowModel().rows.map((row, idx) => {
                      const prevArea = idx > 0
                        ? assessmentTable.getRowModel().rows[idx - 1].original.area
                        : null;
                      const showAreaDivider = prevArea !== null && prevArea !== row.original.area;
                      return (
                        <React.Fragment key={row.id}>
                          {showAreaDivider && (
                            <TableRow className="bg-muted/30 hover:bg-muted/30">
                              <TableCell colSpan={5} className="py-1 px-6">
                                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                  {row.original.area}
                                </span>
                              </TableCell>
                            </TableRow>
                          )}
                          <TableRow>
                            {row.getVisibleCells().map((cell) => (
                              <TableCell key={cell.id} className="py-2.5 align-top first:pl-6 last:pr-6">
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </TableCell>
                            ))}
                          </TableRow>
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Legend */}
        {!loading && (
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground pt-1">
            {[
              { status: "Good",            icon: CheckCircle2, color: "text-green-500" },
              { status: "Warning",         icon: AlertTriangle, color: "text-yellow-500" },
              { status: "Critical",        icon: XCircle,       color: "text-red-500" },
              { status: "Action Required", icon: AlertTriangle, color: "text-red-500" },
              { status: "Configured",      icon: ShieldCheck,   color: "text-blue-500" },
            ].map(({ status, icon: Icon, color }) => (
              <div key={status} className="flex items-center gap-1">
                <Icon className={`w-3.5 h-3.5 ${color}`} />
                <span>{status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SECTION 4 — INTUNE SECURITY CHECKLIST */}
      <ChecklistTable sectionTitle="Intune" groups={intuneChecklist} loading={loading} />

    </div>
  );
}
