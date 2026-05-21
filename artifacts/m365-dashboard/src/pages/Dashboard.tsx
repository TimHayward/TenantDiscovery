import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  RefreshCw, ChevronDown, Printer, Sun, Moon, PanelLeftClose, PanelLeftOpen,
  LayoutDashboard, Users, CreditCard, Shield, Mail,
  MessageSquare, ClipboardCheck, Smartphone, Swords, AppWindow, TrendingUp, BarChart2,
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

export default function Dashboard() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  const queryClient = useQueryClient();
  const { dataUpdatedAt, isLoading, isFetching } = useGetM365Overview();
  const { data: dataSourcesData } = useGetM365DataSources();

  const [isSpinning, setIsSpinning] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showDataSources, setShowDataSources] = useState(false);
  const [selectedIntervalMs, setSelectedIntervalMs] = useState(0);
  const [activeTab, setActiveTab] = useState<NavValue>("overview");
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loading = isLoading || isFetching;
  const dataSourceRows = Array.from(
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
  );

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

  const handleRefresh = () => {
    queryClient.invalidateQueries();
  };

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
    <div className="min-h-screen flex flex-col bg-background">

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
              : <PanelLeftOpen  className="w-4 h-4" />}
          </button>
          <span className="font-bold text-[15px] text-foreground tracking-tight">M365 Health Dashboard</span>
        </div>

        <div className="flex items-center gap-3 print:hidden">
          {/* Split Refresh Button */}
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

          {/* Print Button */}
          <button
            onClick={() => window.print()}
            disabled={loading}
            className="flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors disabled:opacity-50"
            style={{ backgroundColor: isDark ? "rgba(255,255,255,0.1)" : "#F0F1F2", color: isDark ? "#c8c9cc" : "#4b5563" }}
            aria-label="Export as PDF"
          >
            <Printer className="w-3.5 h-3.5" />
          </button>

          {/* Dark Mode Toggle */}
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

      {/* ── Body: sidebar + content ───────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Sidebar ──────────────────────────────────────────────────────────── */}
        <aside
          style={{ width: sidebarExpanded ? "240px" : "48px" }}
          className="shrink-0 flex flex-col bg-sidebar border-r border-sidebar-border transition-[width] duration-200 overflow-hidden print:hidden"
        >
          <nav className="flex-1 py-2 space-y-0.5 overflow-y-auto overflow-x-hidden">
            {NAV_ITEMS.map(({ value, label, icon: Icon }) => {
              const isActive = activeTab === value;
              const btn = (
                <button
                  key={value}
                  onClick={() => setActiveTab(value)}
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
                    <TooltipTrigger asChild>{btn}</TooltipTrigger>
                    <TooltipContent side="right">{label}</TooltipContent>
                  </Tooltip>
                );
              }
              return btn;
            })}
          </nav>

          {sidebarExpanded && (
            <div className="px-3 py-3 border-t border-sidebar-border">
              <p className="text-[10px] text-sidebar-foreground/50 truncate">M365 Tenant Discovery</p>
            </div>
          )}
        </aside>

        {/* ── Main content ─────────────────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto min-w-0">
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

            {/* Tab content — all rendered, inactive hidden to preserve React Query cache */}
            <div className={activeTab === "overview"           ? "" : "hidden"}><OverviewTab /></div>
            <div className={activeTab === "users"              ? "" : "hidden"}><UsersTab /></div>
            <div className={activeTab === "licenses"           ? "" : "hidden"}><LicensesTab /></div>
            <div className={activeTab === "security"           ? "" : "hidden"}><SecurityTab /></div>
            <div className={activeTab === "exchange"           ? "" : "hidden"}><ExchangeTab /></div>
            <div className={activeTab === "teams-sp"           ? "" : "hidden"}><TeamsSharePointTab /></div>
            <div className={activeTab === "compliance"         ? "" : "hidden"}><ComplianceTab /></div>
            <div className={activeTab === "intune"             ? "" : "hidden"}><IntuneTab /></div>
            <div className={activeTab === "defender"           ? "" : "hidden"}><DefenderTab /></div>
            <div className={activeTab === "service-principals" ? "" : "hidden"}><ServicePrincipalsTab /></div>
            <div className={activeTab === "adoption"           ? "" : "hidden"}><AdoptionTab /></div>
            <div className={activeTab === "power-bi"           ? "" : "hidden"}><PowerBITab /></div>

          </div>
        </main>
      </div>
    </div>
  );
}
