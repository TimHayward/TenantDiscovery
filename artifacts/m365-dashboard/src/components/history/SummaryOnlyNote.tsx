import { Archive } from "lucide-react";

/**
 * The fields a live finding carries that a scan-scoped view cannot show, split
 * by the reason it cannot show them.
 *
 * The two reasons are worth keeping apart. `findings_history` stores nine
 * columns per finding; `GET /m365/scans/{id}` returns six of them. So evidence
 * status and confidence are archived and merely not served, which a change to
 * one route would fix, whereas description, remediation and the rest were never
 * written and are gone for every scan already recorded. Either way the field is
 * absent rather than zero, and showing a blank archived field as `0`, or as "no
 * owner", is the defect backlog 5.8 exists to fix elsewhere.
 */
const NEVER_ARCHIVED: string[] = [
  "Description",
  "Remediation",
  "Source metric",
  "Triage state (status, owner, notes, due date)",
  "First seen and last seen",
];

const ARCHIVED_BUT_NOT_SERVED: string[] = [
  "Evidence status",
  "Confidence",
  "the archived metric snapshot payloads (only the list of keys is returned)",
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
          as a summary row per finding, so a scan-scoped view shows less than the live one. Where a
          field is missing it is shown as <span className="font-medium">not archived</span> rather
          than as zero or blank. Never archived: {NEVER_ARCHIVED.join(", ")}. Archived but not
          returned by the scan endpoint: {ARCHIVED_BUT_NOT_SERVED.join(", ")}.
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
