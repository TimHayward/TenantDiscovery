import { useCallback } from "react";
import { useLocationProperty } from "wouter/use-browser-location";

/**
 * The single definition of the dashboard's tabs.
 *
 * Both the router in `App.tsx` and the sidebar in `Dashboard.tsx` are derived
 * from this list, so a tab cannot exist in one and not the other. The order is
 * the order the sidebar renders. Adding a tab here makes `TAB_ICONS` and
 * `TAB_COMPONENTS` in `Dashboard.tsx` incomplete, which is a compile error, so
 * the three stay in step without anyone having to remember they exist.
 */
export const TAB_ROUTES = [
  { id: "overview",           label: "Overview"            },
  { id: "findings",           label: "Findings"            },
  { id: "frameworks",         label: "Framework Mapping"   },
  { id: "users",              label: "Users & Identity"    },
  { id: "licenses",           label: "Licenses"            },
  { id: "security",           label: "Security"            },
  { id: "exchange",           label: "Exchange Online"     },
  { id: "teams-sp",           label: "Teams & SharePoint"  },
  { id: "compliance",         label: "Compliance & Health" },
  { id: "intune",             label: "Intune"              },
  { id: "defender",           label: "Defender"            },
  { id: "service-principals", label: "Enterprise Apps"     },
  { id: "apps",               label: "Apps & Permissions"  },
  { id: "adoption",           label: "Adoption"            },
  { id: "power-bi",           label: "Power BI"            },
  { id: "settings",           label: "Settings"            },
] as const;

export type TabId = (typeof TAB_ROUTES)[number]["id"];

/** The tab `/` resolves to, and the tab an unrecognised identifier falls back to. */
export const DEFAULT_TAB: TabId = "overview";

/**
 * The one route pattern that carries a tab. Declared here rather than inline in
 * `App.tsx` so that `tabHref` and the pattern cannot drift apart.
 */
export const TAB_ROUTE_PATTERN = "/tab/:tab";

const TAB_IDS: ReadonlySet<string> = new Set(TAB_ROUTES.map((tab) => tab.id));

export function isTabId(value: string | undefined): value is TabId {
  return value !== undefined && TAB_IDS.has(value);
}

/**
 * The path for a tab, optionally deep-linked to one of its sections.
 *
 * The result is router-relative: wouter prepends the configured base when it
 * navigates or renders a `<Link>`, so callers must not add it themselves.
 */
export function tabHref(tab: TabId, sectionId?: string): string {
  return sectionId ? `/tab/${tab}#${sectionId}` : `/tab/${tab}`;
}

export const DEFAULT_TAB_HREF = tabHref(DEFAULT_TAB);

/** The section the URL fragment currently points at, without the leading `#`. */
export function readSectionId(): string {
  return typeof window === "undefined" ? "" : window.location.hash.slice(1);
}

/**
 * Whether the URL fragment currently names `elementId`.
 *
 * The snapshot is the boolean rather than the fragment itself so that a
 * navigation only re-renders the one or two sections whose answer actually
 * changed, instead of every mounted section on the page. `useLocationProperty`
 * is wouter's own subscription to `pushState`, `replaceState`, `popstate` and
 * `hashchange`, which is what makes back and forward work here as well as
 * clicks do.
 */
export function useIsSectionTargeted(elementId: string | undefined): boolean {
  return useLocationProperty(
    useCallback(
      () => elementId !== undefined && readSectionId() === elementId,
      [elementId],
    ),
    () => false,
  );
}
