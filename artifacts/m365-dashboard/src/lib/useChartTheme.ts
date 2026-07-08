import type { CSSProperties } from "react";
import { useTheme } from "next-themes";

/**
 * Theme-aware chart variables shared by every Recharts usage. Replaces the
 * identical `gridColor`/`tickColor` dark-mode ternaries that were re-declared
 * in each tab.
 */
export function useChartTheme() {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "#e5e5e5";
  const tickColor = isDark ? "#98999C" : "#71717a";
  const tooltipStyle: CSSProperties = {
    background: isDark ? "#1c1c1f" : "#fff",
    border: `1px solid ${gridColor}`,
    borderRadius: 8,
    fontSize: 12,
  };
  return { isDark, gridColor, tickColor, tooltipStyle };
}
