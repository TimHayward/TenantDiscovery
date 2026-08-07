/**
 * The severity vocabulary shared by the History tab's chart, tables and legend.
 *
 * The trend chart is the view that ends up in a client report, and a client
 * report is usually printed on a monochrome office printer. Colour alone
 * therefore cannot carry the series identity: each severity also gets a stroke
 * dash pattern and a marker shape, and the three are used together everywhere a
 * series is drawn or named. Keeping them in one table is what stops the legend
 * and the chart disagreeing about which line is which.
 */
import type { FindingSeverity } from "@workspace/api-client-react";
import { chartPalette } from "@/lib/chartPalette";

/** Highest first, which is the order the legend and the tables read in. */
export const SEVERITY_ORDER: FindingSeverity[] = ["critical", "high", "medium", "low", "info"];

export type MarkerShape = "circle" | "square" | "triangle" | "diamond" | "cross";

export interface SeveritySeriesSpec {
  severity: FindingSeverity;
  label: string;
  colour: string;
  /** SVG `stroke-dasharray`; empty string is a solid line. */
  dash: string;
  marker: MarkerShape;
}

export const SEVERITY_SERIES: SeveritySeriesSpec[] = [
  { severity: "critical", label: "Critical", colour: chartPalette.red,    dash: "",          marker: "circle"   },
  { severity: "high",     label: "High",     colour: chartPalette.orange, dash: "7 3",       marker: "square"   },
  { severity: "medium",   label: "Medium",   colour: chartPalette.yellow, dash: "2 3",       marker: "triangle" },
  { severity: "low",      label: "Low",      colour: chartPalette.blue,   dash: "9 3 2 3",   marker: "diamond"  },
  { severity: "info",     label: "Info",     colour: chartPalette.gray,   dash: "1 4",       marker: "cross"    },
];

const SPEC_BY_SEVERITY = new Map(SEVERITY_SERIES.map((spec) => [spec.severity as string, spec]));

export function severitySpec(severity: string): SeveritySeriesSpec | undefined {
  return SPEC_BY_SEVERITY.get(severity);
}

export function isKnownSeverity(severity: string): severity is FindingSeverity {
  return SPEC_BY_SEVERITY.has(severity);
}

/**
 * The marker path for a shape, centred on the origin.
 *
 * Recharts wants a dot renderer positioned at `cx`/`cy`, and the legend wants
 * the same shape in a static swatch, so the geometry is produced once here and
 * translated by whichever caller needs it.
 */
export function markerPath(shape: MarkerShape, radius: number): string {
  const r = radius;
  switch (shape) {
    case "square":
      return `M ${-r} ${-r} H ${r} V ${r} H ${-r} Z`;
    case "triangle":
      return `M 0 ${-r * 1.2} L ${r * 1.15} ${r * 0.8} L ${-r * 1.15} ${r * 0.8} Z`;
    case "diamond":
      return `M 0 ${-r * 1.3} L ${r * 1.3} 0 L 0 ${r * 1.3} L ${-r * 1.3} 0 Z`;
    case "cross":
      return `M ${-r * 1.3} 0 H ${r * 1.3} M 0 ${-r * 1.3} V ${r * 1.3}`;
    case "circle":
    default:
      return `M ${-r} 0 A ${r} ${r} 0 1 0 ${r} 0 A ${r} ${r} 0 1 0 ${-r} 0 Z`;
  }
}

/** A cross is drawn with two strokes, so it is the one shape that is not filled. */
export function markerIsStroked(shape: MarkerShape): boolean {
  return shape === "cross";
}
