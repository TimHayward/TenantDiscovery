import { CSVLink } from "react-csv";
import { Download } from "lucide-react";

/**
 * Shared CSV export button. Replaces the per-tab copies (SecurityTab,
 * IntuneTab, DefenderTab, UsersTab's `exportBtn()`, and the inline copies in
 * Licenses/Teams/PowerBI). Renders nothing when there is no data to export.
 *
 * Theme colours are expressed via Tailwind `dark:` classes so the button no
 * longer needs the `useTheme` hook each tab wired up separately.
 */
export function ExportBtn({
  filename,
  data,
  ariaLabel = "Export CSV",
  variant = "icon",
}: {
  filename: string;
  data: object[];
  ariaLabel?: string;
  /** "icon" = compact icon button (default); "button" = bordered "Export CSV" label. */
  variant?: "icon" | "button";
}) {
  if (!data.length) return null;
  if (variant === "button") {
    return (
      <CSVLink
        data={data}
        filename={filename}
        aria-label={ariaLabel}
        className="print:hidden inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] rounded border border-border hover:bg-accent transition-colors"
      >
        <Download className="w-3.5 h-3.5" />
        Export CSV
      </CSVLink>
    );
  }
  return (
    <CSVLink
      data={data}
      filename={filename}
      aria-label={ariaLabel}
      className="print:hidden flex items-center justify-center w-[26px] h-[26px] rounded-[6px] transition-colors hover:opacity-80 bg-muted text-muted-foreground"
    >
      <Download className="w-3.5 h-3.5" />
    </CSVLink>
  );
}
