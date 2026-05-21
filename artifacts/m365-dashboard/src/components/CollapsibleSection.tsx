import { useState, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface CollapsibleSectionProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  defaultOpen?: boolean;
  storageKey?: string;
  sectionId?: string;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  density?: "default" | "compact";
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

  return [open, toggle, setOpen] as const;
}

export function CollapsibleSection({
  title,
  description,
  actions,
  defaultOpen = false,
  storageKey,
  sectionId,
  children,
  className,
  contentClassName,
  density = "default",
}: CollapsibleSectionProps) {
  const [open, toggle, setOpen] = usePersistedToggle(storageKey, defaultOpen);
  const isCompact = density === "compact";
  const elementId = sectionId ?? storageKey;

  useEffect(() => {
    if (!elementId) return;
    function handler(e: Event) {
      const ce = e as CustomEvent<{ id: string }>;
      if (ce.detail?.id === elementId) {
        setOpen(true);
        if (storageKey) {
          try { localStorage.setItem(`m365-section:${storageKey}`, "true"); } catch {}
        }
      }
    }
    window.addEventListener("m365:open-section", handler);
    return () => window.removeEventListener("m365:open-section", handler);
  }, [elementId, storageKey, setOpen]);

  return (
    <Card id={elementId} className={className}>
      <CardHeader
        className={`${isCompact ? "px-3 pt-3 gap-2.5" : "px-4 pt-4 gap-3"} flex-row items-start justify-between space-y-0 cursor-pointer select-none transition-colors hover:bg-muted/30 rounded-t-lg ${open ? (isCompact ? "pb-1.5" : "pb-2") : (isCompact ? "pb-3 rounded-b-lg" : "pb-4 rounded-b-lg")}`}
        onClick={toggle}
      >
        <div className="flex-1 min-w-0">
          <div className="text-base font-semibold leading-none tracking-tight flex items-center gap-2 flex-wrap">
            {title}
          </div>
          {description && (
            <p className={`${isCompact ? "text-[11px] mt-0.5" : "text-xs mt-1"} text-muted-foreground`}>{description}</p>
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
        <CardContent className={`${isCompact ? "pt-0 px-4 pb-3" : "pt-0"} ${contentClassName ?? ""}`}>
          {children}
        </CardContent>
      )}
    </Card>
  );
}
