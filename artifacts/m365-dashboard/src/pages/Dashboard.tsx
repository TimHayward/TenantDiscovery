import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  RefreshCw, ChevronDown, Printer, Sun, Moon, PanelLeftClose, PanelLeftOpen,
  LayoutDashboard, Users, CreditCard, Shield, Mail,
  MessageSquare, ClipboardCheck, Smartphone, Swords, AppWindow, TrendingUp, BarChart2,
  Database, X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useGetM365Overview, useGetM365DataSources } from "@workspace/api-client-react";

import { OverviewTab } from "./tabs/OverviewTab";
import { UsersTab } from "./tabs/UsersTab";
import { LicensesTab } from "./tabs/LicensesTab";
import { SecurityTab } from "./tabs/SecurityTab";
import { ExchangeTab } from "./tabs/ExchangeTab";
import { TeamsSharePointTab } from "./tabs/TeamsSharePointTab";
import { ComplianceTab } from "./tabs/ComplianceTab";
import { IntuneTab } from "./tabs/IntuneTab";
import { ServicePrincipalsTab } from "./tabs/ServicePrincipalsTab";
import { DefenderTab } from "./tabs/DefenderTab";
import { AdoptionTab } from "./tabs/AdoptionTab";
import { PowerBITab } from "./tabs/PowerBITab";
import { TabErrorBoundary } from "@/components/TabErrorBoundary";

const INTERVAL_OPTIONS = [
  { label: "Off", ms: 0 },
  { label: "Every 5 min", ms: 5 * 60 * 1000 },
  { label: "Every 15 min", ms: 15 * 60 * 1000 },
  { label: "Every 1 hour", ms: 60 * 60 * 1000 },
];

const NAV_ITEMS = [
  { value: "overview",           label: "Overview",             icon: LayoutDashboard },
  { value: "users",              label: "Users & Identity",     icon: Users           },
  { value: "licenses",           label: "Licenses",             icon: CreditCard      },
  { value: "security",           label: "Security",             icon: Shield          },
  { value: "exchange",           label: "Exchange Online",      icon: Mail            },
  { value: "teams-sp",           label: "Teams & SharePoint",   icon: MessageSquare   },
  { value: "compliance",         label: "Compliance & Health",  icon: ClipboardCheck  },
  { value: "intune",             label: "Intune",               icon: Smartphone      },
  { value: "defender",           label: "Defender",             icon: Swords          },
  { value: "service-principals", label: "Enterprise Apps",      icon: AppWindow       },
  { value: "adoption",           label: "Adoption",             icon: TrendingUp      },
  { value: "power-bi",           label: "Power BI",             icon: BarChart2       },
] as const;

type NavValue = typeof NAV_ITEMS[number]["value"];

type NavSectionLink = {
  label: string;
  id: string;
  tab?: NavValue;
};

const NAV_SECTIONS: Partial<Record<NavValue, Array<NavSectionLink>>> = {
  overview: [
    { label: "Summary",                    id: "overview-summary"           },
    { label: "Licensing & Service Health", id: "overview-licensing-health"  },
  ],
  users: [
    { label: "Summary",                    id: "users-summary"                   },
    { label: "Stale Accounts",             id: "users-stale-section"             },
    { label: "Administrator Exposure",     id: "users-admin-exposure-section"    },
    { label: "Summary Check List",         id: "users-checklist-section"         },
  ],
  licenses: [
    { label: "Summary",               id: "licenses-summary"       },
    { label: "Stale Licensed Users",  id: "licenses-ghost-users"   },
    { label: "License Subscriptions", id: "licenses-subscriptions" },
  ],
  security: [
    { label: "Summary",                     id: "security-summary"          },
    { label: "Secure Score Breakdown",      id: "security-score-breakdown"  },
    { label: "MFA",                         id: "security-mfa"              },
    { label: "Conditional Access Policies", id: "security-ca-policies"      },
    { label: "Secure Score Controls",       id: "security-settings"         },
    { label: "Summary Check List",          id: "security-checklist"        },
  ],
  exchange: [
    { label: "Summary",            id: "exchange-summary"   },
    { label: "Mail Flow Analysis", id: "exchange-mail-flow" },
    { label: "Summary Check List", id: "exchange-checklist" },
  ],
  "teams-sp": [
    { label: "Microsoft Teams",    id: "teams-ms-teams"  },
    { label: "SharePoint Online",  id: "teams-sharepoint" },
    { label: "Summary Check List", id: "teams-checklist"  },
  ],
  compliance: [
    { label: "Summary",             id: "compliance-summary"              },
    { label: "Service Health",      id: "compliance-service-health-outer" },
    { label: "Sensitivity Labels",  id: "compliance-sensitivity-labels"   },
    { label: "Summary Check List",  id: "compliance-checklist"            },
  ],
  intune: [
    { label: "Summary",               id: "intune-summary"          },
    { label: "Policy Summary",        id: "intune-policy-summary"   },
    { label: "Stale Devices",         id: "intune-stale-devices"    },
    { label: "Enrolled Devices",      id: "intune-enrolled-devices" },
    { label: "Intune Assessment",     id: "intune-assessment"       },
    { label: "App Installation Health", id: "intune-app-install-health" },
    { label: "Discovered App Estate", id: "intune-discovered-apps"  },
    { label: "Summary Check List",    id: "intune-checklist"        },
  ],
  defender: [
    { label: "Device Inventory",               id: "defender-device-inventory"    },
    { label: "Defender for Endpoint Alerts",   id: "defender-mde-alerts"          },
    { label: "Enterprise Applications (SaaS)", id: "defender-saas-apps"           },
    { label: "OAuth Applications",             id: "defender-oauth-apps"          },
    { label: "Defender for Office 365 Alerts", id: "defender-o365-alerts"         },
  ],
  "service-principals": [
    { label: "Summary",                        id: "sp-summary"                 },
    { label: "Enterprise App Registrations",   id: "enterprise-app-registrations-section" },
    { label: "Service Principals & Consent",   id: "service-principals-main"   },
    { label: "Risk Overview",                  id: "sp-risk-overview"           },
    { label: "Security Check List",            id: "enterprise-apps-checklist-section" },
    { label: "Value Gaps",                     id: "adoption-value-gaps", tab: "adoption" },
  ],
  adoption: [
    { label: "Adoption Summary",             id: "adoption-summary" },
    { label: "Adoption Trend",               id: "adoption-trend"   },
    { label: "Value Gaps",                   id: "adoption-value-gaps" },
    { label: "M365 Apps Activation",         id: "adoption-apps"    },
    { label: "Service Activation Matrix",    id: "adoption-matrix" },
  ],
  "power-bi": [
    { label: "Workspaces", id: "powerbi-workspaces" },
  ],
};

type CollectionKeyStatus = { status: "ok" | "error" | "collecting" | "pending"; fetchedAt: string | null; expiresAt: string | null };
type CollectionStatus = { isCollecting: boolean; keys: Record<string, CollectionKeyStatus> };

async function fetchCollectionStatus(): Promise<CollectionStatus> {
  const resp = await fetch("/api/m365/collection-status");
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json() as Promise<CollectionStatus>;
}

async function triggerRefresh(): Promise<void> {
  await fetch("/api/m365/refresh", { method: "POST" });
}

export default function Dashboard() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  const queryClient = useQueryClient();
  const { dataUpdatedAt, isLoading, isFetching } = useGetM365Overview();
  const { data: dataSourcesData } = useGetM365DataSources();

  const [isSpinning, setIsSpinning] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data: collectionStatus } = useQuery({
    queryKey: ["m365-collection-status"],
    queryFn: fetchCollectionStatus,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.isCollecting || isRefreshing ? 5000 : false;
    },
    retry: false,
  });

  const showCollectionBanner = !bannerDismissed && (collectionStatus?.isCollecting || isRefreshing);

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showDataSources, setShowDataSources] = useState(false);
  const [selectedIntervalMs, setSelectedIntervalMs] = useState(0);
  const [activeTab, setActiveTab] = useState<NavValue>("overview");
  const [visitedTabs, setVisitedTabs] = useState<Set<NavValue>>(new Set(["overview"]));
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [scrollTrigger, setScrollTrigger] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pendingScrollId = useRef<string | null>(null);

  const loading = isLoading || isFetching;
  const dataSourceRows = useMemo(() => Array.from(
    new Map(
      ((dataSourcesData as {
        items?: Array<{
          dataSources?: Array<{ provider?: string; label?: string; endpoint?: string }>;
        }>;
      })?.items ?? [])
        .flatMap((item) => item.dataSources ?? [])
        .map((source) => {
          const provider = source.provider || "manual-assessment";
          const label = source.label || "Unknown source";
          const endpoint = source.endpoint || "Manual assessment";
          return [`${provider}|${label}|${endpoint}`, { provider, label, endpoint }] as const;
        })
    ).values()
  ), [dataSourcesData]);

  // Auto-refresh logic
  useEffect(() => {
    if (selectedIntervalMs === 0) return;
    const interval = setInterval(() => {
      queryClient.invalidateQueries();
    }, selectedIntervalMs);
    return () => clearInterval(interval);
  }, [selectedIntervalMs, queryClient]);

  // Click outside dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Spinning animation delay
  useEffect(() => {
    if (loading) {
      setIsSpinning(true);
    } else {
      const t = setTimeout(() => setIsSpinning(false), 600);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [loading]);

  // Scroll to a section after the tab has rendered
  useEffect(() => {
    if (!pendingScrollId.current) return;
    const id = pendingScrollId.current;
    let attempts = 0;
    const tryScroll = () => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        pendingScrollId.current = null;
      } else if (attempts < 10) {
        attempts++;
        setTimeout(tryScroll, 50);
      } else {
        pendingScrollId.current = null;
      }
    };
    tryScroll();
  }, [activeTab, scrollTrigger]);

  const handleRefresh = () => {
    queryClient.invalidateQueries();
  };

  const handleRefreshData = async () => {
    setIsRefreshing(true);
    setBannerDismissed(false);
    try {
      await triggerRefresh();
      queryClient.invalidateQueries({ queryKey: ["m365-collection-status"] });
      // Re-read DB data after a short delay to pick up freshly collected data
      setTimeout(() => {
        queryClient.invalidateQueries();
        setIsRefreshing(false);
      }, 30_000);
    } catch {
      setIsRefreshing(false);
    }
  };

  const switchTab = useCallback((value: NavValue) => {
    setActiveTab(value);
    setVisitedTabs((prev) => {
      if (prev.has(value)) return prev;
      const next = new Set(prev);
      next.add(value);
      return next;
    });
  }, []);

  const navigateToSection = useCallback((tabValue: NavValue, sectionId: string) => {
    window.dispatchEvent(new CustomEvent("m365:open-section", { detail: { id: sectionId } }));
    pendingScrollId.current = sectionId;
    switchTab(tabValue);
    setScrollTrigger((t) => t + 1);
  }, [switchTab]);

  const lastRefreshed = dataUpdatedAt
    ? (() => {
        const d = new Date(dataUpdatedAt);
        const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
        const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return `${time} on ${date}`;
      })()
    : null;

  const activeLabel = NAV_ITEMS.find((n) => n.value === activeTab)?.label ?? "";

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <header className="h-12 shrink-0 flex items-center justify-between px-4 bg-card border-b border-border sticky top-0 z-40 print:hidden">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarExpanded((e) => !e)}
            className="w-7 h-7 flex items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            aria-label={sidebarExpanded ? "Collapse sidebar" : "Expand sidebar"}
          >
            {sidebarExpanded
              ? <PanelLeftClose className="w-4 h-4" />
              : <PanelLeftOpen className="w-4 h-4" />}
          </button>
          <span className="font-bold text-[15px] text-foreground tracking-tight">M365 Health Dashboard</span>
        </div>

        <div className="flex items-center gap-3 print:hidden">
          {/* Refresh Data button */}
          <button
            onClick={handleRefreshData}
            disabled={isRefreshing || collectionStatus?.isCollecting}
            title="Re-collect all data from Microsoft 365"
            className="flex items-center gap-1.5 px-2 h-[26px] rounded-[6px] text-[12px] transition-colors disabled:opacity-50"
            style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }}
          >
            <Database className={`w-3.5 h-3.5 ${isRefreshing ? "animate-pulse" : ""}`} />
            {isRefreshing ? "Refreshing…" : "Refresh Data"}
          </button>

          <div className="relative" ref={dropdownRef}>
            <div
              className="flex items-center rounded-[6px] overflow-hidden h-[26px] text-[12px]"
              style={{
                backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2",
                color: isDark ? "#c8c9cc" : "#4b5563",
              }}
            >
              <button onClick={handleRefresh} disabled={loading} className="flex items-center gap-1 px-2 h-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors disabled:opacity-50">
                <RefreshCw className={`w-3.5 h-3.5 ${isSpinning ? "animate-spin" : ""}`} />
                Refresh
              </button>
              <div className="w-px h-4 shrink-0" style={{ backgroundColor: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)" }} />
              <button onClick={() => setDropdownOpen((o) => !o)} className="flex items-center justify-center px-1.5 h-full hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>

            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-popover text-popover-foreground border rounded-md shadow-md z-50 py-1 text-sm">
                <div className="px-3 py-1.5 text-xs font-semibold text-muted-foreground">Auto-refresh</div>
                {INTERVAL_OPTIONS.map((opt) => (
                  <button
                    key={opt.label}
                    className="w-full text-left px-3 py-1.5 hover:bg-accent hover:text-accent-foreground flex justify-between items-center"
                    onClick={() => { setSelectedIntervalMs(opt.ms); setDropdownOpen(false); }}
                  >
                    {opt.label}
                    {selectedIntervalMs === opt.ms && <span className="w-2 h-2 rounded-full bg-primary" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => window.print()}
            disabled={loading}
            className="flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors disabled:opacity-50"
            style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }}
            aria-label="Export as PDF"
          >
            <Printer className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setTheme(isDark ? "light" : "dark")}
            className="flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors"
            style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }}
            aria-label="Toggle dark mode"
          >
            {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <aside
          style={{ width: sidebarExpanded ? "240px" : "48px" }}
          className="sticky top-12 h-[calc(100vh-3rem)] shrink-0 flex flex-col bg-sidebar border-r border-sidebar-border transition-[width] duration-200 overflow-hidden print:hidden"
        >
          <nav className="flex-1 py-2 overflow-y-auto overflow-x-hidden">
            {NAV_ITEMS.map(({ value, label, icon: Icon }) => {
              const isActive = activeTab === value;
              const sections = NAV_SECTIONS[value] ?? [];

              const mainBtn = (
                <button
                  onClick={() => switchTab(value)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground font-semibold"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {sidebarExpanded && <span className="truncate">{label}</span>}
                  {isActive && sidebarExpanded && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-sidebar-primary-foreground opacity-70 flex-shrink-0" />
                  )}
                </button>
              );

              if (!sidebarExpanded) {
                return (
                  <Tooltip key={value}>
                    <TooltipTrigger asChild>{mainBtn}</TooltipTrigger>
                    <TooltipContent side="right">{label}</TooltipContent>
                  </Tooltip>
                );
              }

              return (
                <div key={value} className="mb-0.5">
                  {mainBtn}
                  {isActive && sections.length > 0 && (
                    <div className="pb-1">
                      {sections.map(({ label: sLabel, id, tab }) => (
                        <button
                          key={id}
                          onClick={() => navigateToSection(tab ?? value, id)}
                          className="w-full flex items-center gap-2 pl-9 pr-3 py-1 text-[12px] text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
                        >
                          <span className="w-1 h-1 rounded-full bg-current opacity-50 shrink-0" />
                          <span className="truncate">{sLabel}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>

          {sidebarExpanded && (
            <div className="px-3 py-3 border-t border-sidebar-border">
              <p className="text-[10px] text-sidebar-foreground/50 truncate">M365 Tenant Discovery</p>
            </div>
          )}
        </aside>

        {/* ── Main content ─────────────────────────────────────────────────────── */}
        <main className="flex-1 min-h-0 overflow-y-auto min-w-0">
          <div className="max-w-[1400px] mx-auto px-6 py-5">

            {/* Content area header */}
            <div className="mb-5">
              <h1 className="font-bold text-2xl text-primary">{activeLabel}</h1>
              <p className="text-muted-foreground mt-1 text-[13px]">
                Comprehensive overview of your Microsoft 365 tenant health and usage
              </p>

              {dataSourceRows.length > 0 && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => setShowDataSources((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showDataSources ? "rotate-180" : ""}`} />
                    See Data Sources
                  </button>

                  {showDataSources && (
                    <div className="mt-2 border rounded-md overflow-hidden bg-card">
                      <div className="max-h-56 overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="text-[11px]">Provider</TableHead>
                              <TableHead className="text-[11px]">Label</TableHead>
                              <TableHead className="text-[11px]">Endpoint</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {dataSourceRows.map((row) => (
                              <TableRow key={`${row.provider}-${row.label}-${row.endpoint}`}>
                                <TableCell className="text-[11px] font-medium whitespace-nowrap">{row.provider}</TableCell>
                                <TableCell className="text-[11px] whitespace-nowrap">{row.label}</TableCell>
                                <TableCell className="text-[11px] font-mono break-all">{row.endpoint}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {lastRefreshed && (
                <p className="text-[12px] text-muted-foreground mt-2">Last refresh: {lastRefreshed}</p>
              )}
            </div>

            {/* Collection-in-progress banner */}
            {showCollectionBanner && (
              <div
                className="mb-4 flex items-center justify-between gap-3 rounded-md border px-4 py-3 text-[13px]"
                style={{
                  backgroundColor: isDark ? "rgba(59,130,246,0.12)" : "rgba(219,234,254,0.8)",
                  borderColor: isDark ? "rgba(59,130,246,0.3)" : "rgba(147,197,253,0.8)",
                  color: isDark ? "#93c5fd" : "#1d4ed8",
                }}
              >
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
                  <span>Data collection in progress — dashboard data will populate within ~3 minutes.</span>
                </div>
                <button
                  onClick={() => setBannerDismissed(true)}
                  className="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100 transition-opacity"
                  aria-label="Dismiss"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Tab content — lazy-mounted on first visit, then kept in DOM to preserve React Query cache */}
            {visitedTabs.has("overview")           && <div className={activeTab === "overview"           ? "" : "hidden"}><TabErrorBoundary><OverviewTab /></TabErrorBoundary></div>}
            {visitedTabs.has("users")              && <div className={activeTab === "users"              ? "" : "hidden"}><TabErrorBoundary><UsersTab /></TabErrorBoundary></div>}
            {visitedTabs.has("licenses")           && <div className={activeTab === "licenses"           ? "" : "hidden"}><TabErrorBoundary><LicensesTab /></TabErrorBoundary></div>}
            {visitedTabs.has("security")           && <div className={activeTab === "security"           ? "" : "hidden"}><TabErrorBoundary><SecurityTab /></TabErrorBoundary></div>}
            {visitedTabs.has("exchange")           && <div className={activeTab === "exchange"           ? "" : "hidden"}><TabErrorBoundary><ExchangeTab /></TabErrorBoundary></div>}
            {visitedTabs.has("teams-sp")           && <div className={activeTab === "teams-sp"           ? "" : "hidden"}><TabErrorBoundary><TeamsSharePointTab /></TabErrorBoundary></div>}
            {visitedTabs.has("compliance")         && <div className={activeTab === "compliance"         ? "" : "hidden"}><TabErrorBoundary><ComplianceTab /></TabErrorBoundary></div>}
            {visitedTabs.has("intune")             && <div className={activeTab === "intune"             ? "" : "hidden"}><TabErrorBoundary><IntuneTab /></TabErrorBoundary></div>}
            {visitedTabs.has("defender")           && <div className={activeTab === "defender"           ? "" : "hidden"}><TabErrorBoundary><DefenderTab /></TabErrorBoundary></div>}
            {visitedTabs.has("service-principals") && <div className={activeTab === "service-principals" ? "" : "hidden"}><TabErrorBoundary><ServicePrincipalsTab /></TabErrorBoundary></div>}
            {visitedTabs.has("adoption")           && <div className={activeTab === "adoption"           ? "" : "hidden"}><TabErrorBoundary><AdoptionTab /></TabErrorBoundary></div>}
            {visitedTabs.has("power-bi")           && <div className={activeTab === "power-bi"           ? "" : "hidden"}><TabErrorBoundary><PowerBITab /></TabErrorBoundary></div>}

          </div>
        </main>
      </div>
    </div>
  );
}
