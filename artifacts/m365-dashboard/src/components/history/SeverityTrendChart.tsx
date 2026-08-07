import { useMemo, type ReactElement } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ScanDetail, ScanRun } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui-kit/table";
import { useChartTheme } from "@/lib/useChartTheme";
import {
  SEVERITY_SERIES,
  markerIsStroked,
  markerPath,
  type SeveritySeriesSpec,
} from "./severitySeries";

export interface TrendPoint {
  scanId: string;
  label: string;
  /** Full timestamp, used by the tooltip and the companion table. */
  when: string;
  counts: Record<string, number>;
  /** Findings whose severity is not one of the five known values. */
  other: number;
  /** False when this scan's detail request failed, so the point is a gap. */
  known: boolean;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function shortDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function shortTime(date: Date): string {
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/**
 * Build the plot points for a window of scans.
 *
 * The axis labels are decided for the window as a whole rather than per point:
 * when every scan in the window lands on its own day the labels are dates, and
 * as soon as two share a day every label gains a time. Mixing the two would
 * make two adjacent ticks look like different quantities.
 */
export function buildTrendPoints(
  windowed: ScanRun[],
  details: Map<string, ScanDetail>,
): TrendPoint[] {
  const dates = windowed.map((run) => new Date(run.startedAt));
  const needsTime = dates.some((date, i) => i > 0 && sameDay(date, dates[i - 1]));

  return windowed.map((run, i) => {
    const date = dates[i];
    const detail = details.get(run.id);
    const counts: Record<string, number> = {};
    for (const spec of SEVERITY_SERIES) counts[spec.severity] = 0;
    let other = 0;

    for (const finding of detail?.findings ?? []) {
      if (finding.severity in counts) counts[finding.severity] += 1;
      else other += 1;
    }

    return {
      scanId: run.id,
      label: needsTime ? `${shortDate(date)} ${shortTime(date)}` : shortDate(date),
      when: `${shortDate(date)} ${shortTime(date)}`,
      counts,
      other,
      known: detail !== undefined,
    };
  });
}

type ChartRow = { label: string; when: string } & Record<string, string | number | null>;

function toChartRows(points: TrendPoint[]): ChartRow[] {
  return points.map((point) => {
    const row: ChartRow = { label: point.label, when: point.when };
    for (const spec of SEVERITY_SERIES) {
      // A scan whose detail could not be read is a gap in the line, not a zero.
      row[spec.severity] = point.known ? point.counts[spec.severity] : null;
    }
    return row;
  });
}

interface DotRenderProps {
  cx?: number;
  cy?: number;
  index?: number;
}

/**
 * A marker renderer for one severity.
 *
 * Recharts types the `dot` render prop as returning `ReactElement<SVGElement>`,
 * which no ordinary SVG element satisfies, so the assertion here is a cast
 * around that declaration rather than a claim about the value.
 */
function severityMarker(spec: SeveritySeriesSpec) {
  const radius = 3.2;
  const stroked = markerIsStroked(spec.marker);
  return (props: DotRenderProps): ReactElement<SVGElement> => {
    const { cx, cy } = props;
    if (cx === undefined || cy === undefined) {
      return (<g key={`${spec.severity}-${props.index}`} />) as unknown as ReactElement<SVGElement>;
    }
    return (
      <path
        key={`${spec.severity}-${props.index}`}
        transform={`translate(${cx}, ${cy})`}
        d={markerPath(spec.marker, radius)}
        fill={stroked ? "none" : spec.colour}
        stroke={spec.colour}
        strokeWidth={stroked ? 1.6 : 1}
      />
    ) as unknown as ReactElement<SVGElement>;
  };
}

/** Legend drawn from the same table the chart draws from, so they cannot disagree. */
export function SeverityTrendLegend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5" aria-label="Severity series key">
      {SEVERITY_SERIES.map((spec) => {
        const stroked = markerIsStroked(spec.marker);
        return (
          <li key={spec.severity} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <svg width="34" height="12" aria-hidden="true">
              <line
                x1="1"
                y1="6"
                x2="33"
                y2="6"
                stroke={spec.colour}
                strokeWidth="2"
                strokeDasharray={spec.dash || undefined}
              />
              <path
                transform="translate(17, 6)"
                d={markerPath(spec.marker, 3.2)}
                fill={stroked ? "none" : spec.colour}
                stroke={spec.colour}
                strokeWidth={stroked ? 1.6 : 1}
              />
            </svg>
            {spec.label}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * What the trend section shows when there is exactly one scan.
 *
 * A single point is not a trend, and an axis drawn through one observation
 * invites a reader to see a direction that has not been measured. The counts
 * are still worth showing, so they are shown as counts and named as a starting
 * position rather than as a line.
 */
export function SingleScanSnapshot({ point }: { point: TrendPoint }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        One scan recorded, on {point.when}. A trend needs at least two, so this is the starting
        position rather than a direction of travel.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {SEVERITY_SERIES.map((spec) => (
          <div key={spec.severity} className="rounded-md border p-3 text-center">
            <p className="text-[11px] text-muted-foreground">{spec.label}</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums">
              {point.known ? point.counts[spec.severity] : "—"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A line per severity, a point per scan.
 *
 * Each series carries a colour, a dash pattern and a marker shape at once. The
 * colours are the dashboard's severity colours, but they are the least load
 * bearing of the three: printed on a monochrome office printer, which is where
 * this chart usually ends up, the dashes and markers are what still tell the
 * five lines apart. The table below the chart carries the same numbers for the
 * same reason, and answers the question a reader asks of a trend anyway, which
 * is what the value actually was.
 */
export function SeverityTrendChart({ points }: { points: TrendPoint[] }) {
  const { gridColor, tickColor, tooltipStyle } = useChartTheme();
  const rows = useMemo(() => toChartRows(points), [points]);
  const otherTotal = points.reduce((sum, point) => sum + point.other, 0);

  return (
    <div className="space-y-3">
      <div className="print:break-inside-avoid">
        <ResponsiveContainer width="100%" height={320} debounce={0}>
          <LineChart data={rows} margin={{ left: 4, right: 16, top: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: tickColor }}
              stroke={tickColor}
              // Thin the labels rather than overlap them once the window is
              // long: the first and last scan always keep their tick, which are
              // the two a reader looks for.
              interval="preserveStartEnd"
              minTickGap={28}
              tickMargin={6}
            />
            <YAxis
              allowDecimals={false}
              width={34}
              tick={{ fontSize: 11, fill: tickColor }}
              stroke={tickColor}
            />
            <Tooltip
              isAnimationActive={false}
              contentStyle={tooltipStyle}
              labelFormatter={(_label: string, payload) => {
                const row = payload?.[0]?.payload as ChartRow | undefined;
                return row ? String(row.when) : "";
              }}
            />
            {SEVERITY_SERIES.map((spec) => (
              <Line
                key={spec.severity}
                type="linear"
                dataKey={spec.severity}
                name={spec.label}
                stroke={spec.colour}
                strokeWidth={2}
                strokeDasharray={spec.dash || undefined}
                dot={severityMarker(spec)}
                activeDot={{ r: 5 }}
                isAnimationActive={false}
                connectNulls={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <SeverityTrendLegend />
          <p className="text-[11px] text-muted-foreground">
            One point per scan, spaced evenly rather than by elapsed time.
          </p>
        </div>
      </div>

      {otherTotal > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {otherTotal} archived finding{otherTotal === 1 ? " carries" : "s carry"} a severity outside
          the five plotted here and {otherTotal === 1 ? "is" : "are"} not shown.
        </p>
      )}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-8 pl-3 text-[11px]">Scan</TableHead>
              {SEVERITY_SERIES.map((spec) => (
                <TableHead key={spec.severity} className="h-8 text-[11px]">
                  {spec.label}
                </TableHead>
              ))}
              <TableHead className="h-8 text-[11px]">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {points.map((point) => {
              const total = SEVERITY_SERIES.reduce(
                (sum, spec) => sum + point.counts[spec.severity],
                0,
              );
              return (
                <TableRow key={point.scanId}>
                  <TableCell className="py-1.5 pl-3 text-xs whitespace-nowrap">{point.when}</TableCell>
                  {SEVERITY_SERIES.map((spec) => (
                    <TableCell key={spec.severity} className="py-1.5 text-xs tabular-nums">
                      {point.known ? point.counts[spec.severity] : "—"}
                    </TableCell>
                  ))}
                  <TableCell className="py-1.5 text-xs font-medium tabular-nums">
                    {point.known ? total + point.other : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
