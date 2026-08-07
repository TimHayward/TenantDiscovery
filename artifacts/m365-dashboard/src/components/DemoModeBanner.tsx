import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";

interface DemoModeDescriptor {
  demoMode: boolean;
  profile: string | null;
  name: string | null;
  description: string | null;
  recordedAt: string | null;
  synthetic: boolean | null;
  schemaVersion: number | null;
}

async function getDemoMode(): Promise<DemoModeDescriptor> {
  const response = await fetch("/api/m365/demo-mode");
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return (await response.json()) as DemoModeDescriptor;
}

/**
 * The permanent notice that the data on screen is fictional.
 *
 * The failure this exists to prevent is somebody screenshotting a demonstration
 * tenant and sending it to a client as their assessment, so it is designed
 * against that rather than against tidiness:
 *
 *   - it is fixed to the top of the viewport and reserves its own height, so it
 *     is in the frame of any screenshot of any tab rather than scrolled away;
 *   - it has no close control and holds no dismissed state, so there is nothing
 *     to click and nothing that a reload could restore;
 *   - it renders above the router, so it survives every navigation, including
 *     the onboarding page and the not-found page;
 *   - the flag comes from the API response, not from a build-time constant, so
 *     a production build of this dashboard pointed at a demonstration server
 *     still shows it.
 *
 * While the query is in flight nothing is rendered. That is the one honest
 * choice available: a banner shown before the server has answered would be
 * wrong on a live tenant, and the alternative failure — a screenshot taken in
 * the few hundred milliseconds before the first response — needs the page to
 * have rendered its data anyway, which it cannot have done by then.
 */
export function DemoModeBanner() {
  const { data } = useQuery({
    queryKey: ["demo-mode"],
    queryFn: getDemoMode,
    // Whether the server is a demonstration server does not change while the
    // page is open, but a failed first request must not leave the banner off.
    retry: 3,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });

  if (!data?.demoMode) return null;

  const label = data.name ?? data.profile ?? "unknown profile";

  return (
    <>
      <div
        role="alert"
        data-testid="demo-mode-banner"
        className="fixed inset-x-0 top-0 z-[200] flex items-center justify-center gap-2 border-b-2 border-amber-500 bg-amber-400 px-4 py-2 text-center text-sm font-semibold text-amber-950 shadow-md"
      >
        <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
        <span>
          Demonstration data. This is not a real tenant and these figures are not an
          assessment of one. Fixture profile: {label}.
        </span>
      </div>
      {/* Reserves the banner's height so it covers no content on any tab. */}
      <div className="h-10" aria-hidden="true" />
    </>
  );
}

export default DemoModeBanner;
