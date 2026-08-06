import { Card, CardContent } from "@workspace/ui-kit/card";
import { Skeleton } from "@workspace/ui-kit/skeleton";
import { Badge } from "@/components/ui/badge";
import { ArrowUpIcon, ArrowDownIcon, AlertTriangleIcon, KeyRoundIcon, BadgeAlertIcon } from "lucide-react";
import type { ConfidenceLabel, EvidenceStatus } from "@workspace/permissions-manifest";
import { issueKindLabel, type IssueKind } from "@/lib/collectionStatus";
import { kpiAccent } from "@/lib/chartPalette";
import { CONFIDENCE_LABEL, EVIDENCE_STATUS_LABEL } from "@/lib/statusTokens";

const ISSUE_ICONS: Record<IssueKind, typeof AlertTriangleIcon> = {
  permission: KeyRoundIcon,
  license: BadgeAlertIcon,
  error: AlertTriangleIcon,
};

interface KPICardProps {
  title: string;
  value?: string | number | null;
  change?: string;
  trend?: "up" | "down" | "neutral";
  loading?: boolean;
  valueColor?: string;
  evidenceStatus?: EvidenceStatus;
  confidenceLabel?: ConfidenceLabel;
  density?: "default" | "compact";
  /** When set, the card shows a collection-issue state instead of a bare value. */
  issueKind?: IssueKind;
  /** Hover detail for the issue badge (e.g. the Graph error message). */
  issueMessage?: string;
}

export function KPICard({
  title,
  value,
  change,
  trend,
  loading,
  valueColor = kpiAccent,
  evidenceStatus,
  confidenceLabel,
  density = "compact",
  issueKind,
  issueMessage,
}: KPICardProps) {
  const isPositive = trend === "up";
  const isCompact = density === "compact";
  const IssueIcon = issueKind ? ISSUE_ICONS[issueKind] : null;

  return (
    <Card>
      <CardContent className={`${isCompact ? "p-4" : "p-6"} flex h-full min-w-0 flex-col justify-center`}>
        {loading ? (
          <>
            <Skeleton className="h-4 w-24 mb-2" />
            <Skeleton className={isCompact ? "h-7 w-28" : "h-8 w-32"} />
          </>
        ) : (
          <>
            <p className={`${isCompact ? "text-xs" : "text-sm"} text-muted-foreground font-medium leading-tight break-words`}>{title}</p>
            {issueKind && IssueIcon ? (
              <div
                className={`${isCompact ? "mt-0.5" : "mt-1"} flex items-center gap-1.5 text-amber-600 dark:text-amber-400`}
                title={issueMessage}
              >
                <IssueIcon className={isCompact ? "w-4 h-4" : "w-5 h-5"} />
                <span className={`${isCompact ? "text-sm" : "text-base"} font-semibold leading-tight`}>
                  {issueKindLabel(issueKind)}
                </span>
              </div>
            ) : (
              <p className={`${isCompact ? "text-xl mt-0.5" : "text-2xl mt-1"} font-bold leading-tight break-words [overflow-wrap:anywhere]`} style={{ color: valueColor }}>
                {value !== undefined && value !== null ? value : "--"}
              </p>
            )}
            {change && trend && trend !== "neutral" && (
              <div className={`flex items-center gap-1 ${isCompact ? "mt-0.5" : "mt-1"}`}>
                {isPositive ? <ArrowUpIcon className="w-4 h-4 text-green-600 dark:text-green-400" /> : <ArrowDownIcon className="w-4 h-4 text-red-600 dark:text-red-400" />}
                <span className={`text-sm ${isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                  {change}
                </span>
              </div>
            )}
            {change && trend === "neutral" && (
              <div className={`flex items-center gap-1 ${isCompact ? "mt-0.5" : "mt-1"}`}>
                <span className="text-sm text-muted-foreground">{change}</span>
              </div>
            )}
            {(evidenceStatus || confidenceLabel) && (
              <div className={`${isCompact ? "mt-1.5" : "mt-2"} flex flex-wrap gap-1`}>
                {evidenceStatus && (
                  <Badge variant="outline" className="max-w-full whitespace-normal break-words text-[10px] font-normal leading-tight">
                    {EVIDENCE_STATUS_LABEL[evidenceStatus]}
                  </Badge>
                )}
                {confidenceLabel && (
                  <Badge variant="outline" className="max-w-full whitespace-normal break-words text-[10px] font-normal leading-tight">
                    {CONFIDENCE_LABEL[confidenceLabel]}
                  </Badge>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
