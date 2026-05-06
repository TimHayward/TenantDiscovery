import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ArrowUpIcon, ArrowDownIcon } from "lucide-react";
import type { ConfidenceLabel, EvidenceStatus } from "@workspace/permissions-manifest";

const EVIDENCE_STATUS_LABELS: Record<EvidenceStatus, string> = {
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

interface KPICardProps {
  title: string;
  value?: string | number | null;
  change?: string;
  trend?: "up" | "down" | "neutral";
  loading?: boolean;
  valueColor?: string;
  evidenceStatus?: EvidenceStatus;
  confidenceLabel?: ConfidenceLabel;
}

export function KPICard({
  title,
  value,
  change,
  trend,
  loading,
  valueColor = "#0079F2",
  evidenceStatus,
  confidenceLabel,
}: KPICardProps) {
  const isPositive = trend === "up";
  const isNegative = trend === "down";

  return (
    <Card>
      <CardContent className="p-6 flex flex-col justify-center">
        {loading ? (
          <>
            <Skeleton className="h-4 w-24 mb-2" />
            <Skeleton className="h-8 w-32" />
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground font-medium">{title}</p>
            <p className="text-2xl font-bold mt-1" style={{ color: valueColor }}>
              {value !== undefined && value !== null ? value : "--"}
            </p>
            {change && trend && trend !== "neutral" && (
              <div className="flex items-center gap-1 mt-1">
                {isPositive ? <ArrowUpIcon className="w-4 h-4 text-green-600 dark:text-green-400" /> : <ArrowDownIcon className="w-4 h-4 text-red-600 dark:text-red-400" />}
                <span className={`text-sm ${isPositive ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                  {change}
                </span>
              </div>
            )}
            {change && trend === "neutral" && (
              <div className="flex items-center gap-1 mt-1">
                <span className="text-sm text-muted-foreground">{change}</span>
              </div>
            )}
            {(evidenceStatus || confidenceLabel) && (
              <div className="mt-2 flex flex-wrap gap-1">
                {evidenceStatus && (
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {EVIDENCE_STATUS_LABELS[evidenceStatus]}
                  </Badge>
                )}
                {confidenceLabel && (
                  <Badge variant="outline" className="text-[10px] font-normal">
                    {CONFIDENCE_LABELS[confidenceLabel]}
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
