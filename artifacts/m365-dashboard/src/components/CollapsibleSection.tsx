import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface CollapsibleSectionProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  defaultOpen?: boolean;
  storageKey?: string;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

function usePersistedToggle(storageKey: string | undefined, defaultOpen: boolean) {
  const [open, setOpen] = useState(() => {
    if (!storageKey) return defaultOpen;
    try {
      const stored = localStorage.getItem(`m365-section:${storageKey}`);
      if (stored !== null) return stored === "true";
    } catch {}
    return defaultOpen;
  });

  const toggle = () =>
    setOpen((prev) => {
      const next = !prev;
      if (storageKey) {
        try {
          localStorage.setItem(`m365-section:${storageKey}`, String(next));
        } catch {}
      }
      return next;
    });

  return [open, toggle] as const;
}

export function CollapsibleSection({
  title,
  description,
  actions,
  defaultOpen = false,
  storageKey,
  children,
  className,
  contentClassName,
}: CollapsibleSectionProps) {
  const [open, toggle] = usePersistedToggle(storageKey, defaultOpen);

  return (
    <Card className={className}>
      <CardHeader
        className={`px-4 pt-4 flex-row items-start justify-between space-y-0 gap-3 cursor-pointer select-none transition-colors hover:bg-muted/30 rounded-t-lg ${open ? "pb-2" : "pb-4 rounded-b-lg"}`}
        onClick={toggle}
      >
        <div className="flex-1 min-w-0">
          <div className="text-base font-semibold leading-none tracking-tight flex items-center gap-2 flex-wrap">
            {title}
          </div>
          {description && (
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {actions && (
            <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
              {actions}
            </div>
          )}
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground transition-transform duration-200 flex-shrink-0 ${open ? "rotate-180" : ""}`}
          />
        </div>
      </CardHeader>
      {open && (
        <CardContent className={`pt-0 ${contentClassName ?? ""}`}>
          {children}
        </CardContent>
      )}
    </Card>
  );
}
