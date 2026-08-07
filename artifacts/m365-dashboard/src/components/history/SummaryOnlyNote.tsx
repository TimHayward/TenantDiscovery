import { Archive } from "lucide-react";

/**
 * The fields a live finding carries that the scan archive does not.
 *
 * `findings_history` stores nine columns per finding and `/m365/scans/{id}`
 * returns six of them. Everything below is therefore genuinely absent from a
 * scan-scoped view rather than merely zero, and the difference matters: showing
 * a blank archived field as `0`, or as "no owner", is the defect backlog 5.8
 * exists to fix elsewhere, so this tab names the gap instead.
 */
const UNARCHIVED_FIELDS: string[] = [
  "Description",
  "Remediation",
  "Evidence status",
  "Confidence",
  "Source metric",
  "Triage state (status, owner, notes, due date)",
  "First seen and last seen",
];

/**
 * The standing caveat on any view built from the scan archive.
 *
 * Rendered inside the scan-scoped sections rather than once at the top of the
 * tab, because a reader who expands one section and screenshots it should get
 * the caveat in the screenshot.
 */
export function SummaryOnlyNote({
  children,
}: {
  /** Extra sentence for a section whose gap is narrower or wider than the default. */
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
      <Archive className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <div>
        <p>
          <span className="font-medium text-foreground">Summary only.</span> Each scan is archived
          as a summary row per finding. These fields are not archived and are shown as{" "}
          <span className="font-medium">not archived</span> rather than as zero or blank:{" "}
          {UNARCHIVED_FIELDS.join(", ")}.
        </p>
        {children && <p className="mt-1">{children}</p>}
      </div>
    </div>
  );
}

/**
 * The placeholder for one such field, so that "not archived" reads the same
 * everywhere and can never be mistaken for a measured zero.
 */
export function NotArchived({ label = "Not archived" }: { label?: string }) {
  return (
    <span className="italic text-muted-foreground" title="This field is not stored in the scan archive">
      {label}
    </span>
  );
}
