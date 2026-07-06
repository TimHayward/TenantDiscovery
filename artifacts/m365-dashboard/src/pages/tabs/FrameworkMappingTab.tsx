import { useGetM365FrameworkCoverage, type FrameworkCoverage, type FrameworkControlCoverage } from "@workspace/api-client-react";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CHECK_STATUS_BADGE_CLASS as STATUS_STYLES, CHECK_STATUS_LABEL as STATUS_LABEL } from "@/lib/statusTokens";

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={`${STATUS_STYLES[status] ?? STATUS_STYLES.notAssessed} font-normal text-xs border-0`}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

function ControlRow({ control }: { control: FrameworkControlCoverage }) {
  const counts = [
    control.failCount ? `${control.failCount} fail` : null,
    control.warningCount ? `${control.warningCount} review` : null,
    control.manualCount ? `${control.manualCount} manual` : null,
    control.passCount ? `${control.passCount} pass` : null,
  ].filter(Boolean).join(", ");
  return (
    <TableRow>
      <TableCell className="pl-4 py-2 align-top text-xs font-mono whitespace-nowrap">{control.controlId}</TableCell>
      <TableCell className="py-2 align-top">
        <p className="text-sm font-medium">{control.title}</p>
        <p className="text-xs text-muted-foreground">{control.requirement}</p>
      </TableCell>
      <TableCell className="py-2 align-top"><StatusBadge status={control.status} /></TableCell>
      <TableCell className="py-2 align-top text-xs text-muted-foreground">
        {control.findingCount === 0 ? "no mapped findings" : counts}
      </TableCell>
    </TableRow>
  );
}

function FrameworkPanel({ fw }: { fw: FrameworkCoverage }) {
  const s = fw.summary;
  return (
    <CollapsibleSection
      title={fw.name}
      description={`${s.coveragePercent}% of controls fully satisfied — ${s.pass} pass, ${s.fail} fail, ${s.warning} review, ${s.manual} manual, ${s.notAssessed} not assessed`}
      storageKey={`framework-${fw.framework}`}
      defaultOpen={true}
      density="compact"
    >
      <div className="space-y-3">
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {([
            ["Controls", s.totalControls, "text-foreground"],
            ["Pass", s.pass, "text-green-600 dark:text-green-400"],
            ["Fail", s.fail, "text-red-600 dark:text-red-400"],
            ["Review", s.warning, "text-yellow-600 dark:text-yellow-400"],
            ["Manual", s.manual, "text-blue-600 dark:text-blue-400"],
            ["Not assessed", s.notAssessed, "text-muted-foreground"],
          ] as const).map(([label, value, tone]) => (
            <Card key={label}>
              <CardContent className="p-3 text-center">
                <p className="text-[11px] text-muted-foreground">{label}</p>
                <p className={`text-xl font-bold mt-0.5 ${tone}`}>{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4 h-8 w-[90px]">Control</TableHead>
                  <TableHead className="h-8">Requirement</TableHead>
                  <TableHead className="h-8 w-[110px]">Status</TableHead>
                  <TableHead className="h-8 w-[200px]">Mapped findings</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fw.controls.map((c) => <ControlRow key={`${c.framework}:${c.controlId}`} control={c} />)}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </CollapsibleSection>
  );
}

export function FrameworkMappingTab() {
  const { data, isLoading, isFetching } = useGetM365FrameworkCoverage();
  const loading = isLoading || isFetching;
  const frameworks = data?.frameworks ?? [];

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(2)].map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Each recognised-baseline control is rolled up from the findings that evidence it (worst status wins).
        Controls with no mapped findings show as “Not assessed”.
      </p>
      {frameworks.map((fw) => <FrameworkPanel key={fw.framework} fw={fw} />)}
    </div>
  );
}
