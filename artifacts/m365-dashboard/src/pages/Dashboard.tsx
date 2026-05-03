import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, ChevronDown, Printer, Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { useGetM365Overview } from "@workspace/api-client-react";

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

const DATA_SOURCES: string[] = ["Microsoft Graph API"];

const INTERVAL_OPTIONS = [
  { label: "Off", ms: 0 },
  { label: "Every 5 min", ms: 5 * 60 * 1000 },
  { label: "Every 15 min", ms: 15 * 60 * 1000 },
  { label: "Every 1 hour", ms: 60 * 60 * 1000 },
];

export default function Dashboard() {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";
  
  const queryClient = useQueryClient();
  const { dataUpdatedAt, isLoading, isFetching } = useGetM365Overview();
  
  const [isSpinning, setIsSpinning] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedIntervalMs, setSelectedIntervalMs] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loading = isLoading || isFetching;

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

  return (
    <div className="min-h-screen bg-background px-5 py-4 pt-[32px] pb-[32px] pl-[24px] pr-[24px]">
      <div className="max-w-[1400px] mx-auto">
        
        {/* ── Header ── */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="pt-2">
            <h1 className="font-bold text-[32px] text-primary">M365 Health Dashboard</h1>
            <p className="text-muted-foreground mt-1.5 text-[14px]">Comprehensive overview of your Microsoft 365 tenant health and usage</p>
            
            {DATA_SOURCES.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <span className="text-[12px] text-muted-foreground shrink-0">
                  Data Sources:
                </span>
                {DATA_SOURCES.map((source) => (
                  <span
                    key={source}
                    className="text-[12px] font-bold rounded px-2 py-0.5 truncate print:!bg-[rgb(229,231,235)] print:!text-[rgb(75,85,99)]"
                    title={source}
                    style={{
                      maxWidth: "20ch",
                      backgroundColor: isDark
                        ? "rgba(255,255,255,0.1)"
                        : "rgb(229, 231, 235)",
                      color: isDark ? "#c8c9cc" : "rgb(75, 85, 99)",
                    }}
                  >
                    {source}
                  </span>
                ))}
              </div>
            )}
            
            {lastRefreshed && <p className="text-[12px] text-muted-foreground mt-3">Last refresh: {lastRefreshed}</p>}
          </div>
          
          <div className="flex items-center gap-3 pt-2 print:hidden">
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
        </div>

        {/* ── Tabs Navigation ── */}
        <Tabs defaultValue="overview" className="w-full">
          <div className="overflow-x-auto pb-2 scrollbar-hide">
            <TabsList className="h-10 justify-start mb-6 inline-flex w-auto min-w-max bg-muted/50 border">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="users">Users & Identity</TabsTrigger>
              <TabsTrigger value="licenses">Licenses</TabsTrigger>
              <TabsTrigger value="security">Security</TabsTrigger>
              <TabsTrigger value="exchange">Exchange Online</TabsTrigger>
              <TabsTrigger value="teams-sp">Teams & SharePoint</TabsTrigger>
              <TabsTrigger value="compliance">Compliance & Health</TabsTrigger>
              <TabsTrigger value="intune">Intune</TabsTrigger>
              <TabsTrigger value="defender">Defender</TabsTrigger>
              <TabsTrigger value="service-principals">Enterprise Apps</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="overview" className="focus-visible:outline-none">
            <OverviewTab />
          </TabsContent>
          <TabsContent value="users" className="focus-visible:outline-none">
            <UsersTab />
          </TabsContent>
          <TabsContent value="licenses" className="focus-visible:outline-none">
            <LicensesTab />
          </TabsContent>
          <TabsContent value="security" className="focus-visible:outline-none">
            <SecurityTab />
          </TabsContent>
          <TabsContent value="exchange" className="focus-visible:outline-none">
            <ExchangeTab />
          </TabsContent>
          <TabsContent value="teams-sp" className="focus-visible:outline-none">
            <TeamsSharePointTab />
          </TabsContent>
          <TabsContent value="compliance" className="focus-visible:outline-none">
            <ComplianceTab />
          </TabsContent>
          <TabsContent value="intune" className="focus-visible:outline-none">
            <IntuneTab />
          </TabsContent>
          <TabsContent value="defender" className="focus-visible:outline-none">
            <DefenderTab />
          </TabsContent>
          <TabsContent value="service-principals" className="focus-visible:outline-none">
            <ServicePrincipalsTab />
          </TabsContent>
        </Tabs>

      </div>
    </div>
  );
}
