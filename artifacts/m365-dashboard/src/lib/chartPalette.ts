/**
 * Canonical chart/data-visualisation palette for the dashboard.
 *
 * Replaces the ~10 per-tab `CHART_COLORS` / `C` / `PALETTE` objects that had
 * drifted apart. Import named colours for specific series, or `chartSeries`
 * for an ordered categorical sequence (donuts, multi-series bars).
 */
export const chartPalette = {
  blue: "#1E3D59",
  purple: "#795EFF",
  green: "#009118",
  red: "#A60808",
  pink: "#ec4899",
  yellow: "#eab308",
  orange: "#f97316",
  warning: "#d97706",
  gray: "#9ca3af",
} as const;

export type ChartColorName = keyof typeof chartPalette;

/** Ordered categorical sequence for charts with multiple series/slices. */
export const chartSeries: string[] = [
  chartPalette.blue,
  chartPalette.purple,
  chartPalette.green,
  chartPalette.red,
  chartPalette.pink,
];

/** Default accent used by KPI values (previously hardcoded in KPICard). */
export const kpiAccent = "#FA9819";
