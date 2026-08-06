import { Switch, Route, Redirect, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "next-themes";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import OnboardingPage from "@/pages/OnboardingPage";
import { getOnboardingStatus } from "@/lib/onboardingApi";
import { DEFAULT_TAB_HREF, TAB_ROUTE_PATTERN, isTabId } from "@/lib/tabRoutes";

/**
 * Serves browser history traversal with a document navigation instead of a
 * client-side render.
 *
 * This is a workaround for a defect, and it should be removed once the defect is
 * fixed. Rendering the dashboard in response to a `popstate` sends React into a
 * render loop it never leaves: the tab lands with the correct URL and then the
 * page stops responding to anything, in an ordinary browser window as well as a
 * headless one. It reproduces whenever the Intune tab is mounted, visible or
 * hidden, and not at all when it is not; it does not reproduce for the same tab
 * change made by clicking, because that update is flushed after the click event
 * rather than inside the browser's own handler. The cause is inside
 * `pages/tabs/IntuneTab.tsx`, which this task is not allowed to change beyond
 * how it navigates, so it is contained here rather than fixed.
 *
 * `stopImmediatePropagation` runs before wouter's own listeners because this
 * module is evaluated before any component subscribes, so React never sees the
 * event and never starts the loop. Reloading then lands on the entry the user
 * asked for, fragment included, because `location` has already been updated by
 * the time the event fires. Back and forward therefore walk tab history
 * correctly; the cost is that they reload rather than transition, so the visited
 * tabs are re-fetched. Clicks and deep links are untouched and stay instant,
 * because wouter's `pushState` never raises either of these events.
 *
 * Both events are needed: stepping back over a `#section` fragment raises
 * `hashchange` as well as `popstate`, and either one reaching wouter is enough
 * to start the loop.
 *
 * To check whether it is still needed: remove this, open `/tab/intune`, click to
 * any other tab and press Back. A frozen page is the defect.
 */
if (typeof window !== "undefined") {
  for (const type of ["popstate", "hashchange"]) {
    window.addEventListener(type, (event) => {
      event.stopImmediatePropagation();
      window.location.reload();
    });
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Snapshots refresh server-side on a 30-min tick; a 0 staleTime only
      // multiplied refetches (and skeleton blanking) without fresher data.
      staleTime: 60_000,
    },
  },
});

function Router() {
  const onboardingQuery = useQuery({
    queryKey: ["onboarding-status"],
    queryFn: getOnboardingStatus,
    retry: 1,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (onboardingQuery.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
        Checking onboarding requirements...
      </div>
    );
  }

  if (onboardingQuery.data?.needsOnboarding) {
    return (
      <OnboardingPage
        status={onboardingQuery.data}
        onRefreshStatus={async () => {
          await onboardingQuery.refetch();
        }}
      />
    );
  }

  if (onboardingQuery.isError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4 text-center">
        <p className="text-base font-medium">Unable to verify onboarding requirements.</p>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Fix API connectivity or credentials and refresh the page.
        </p>
      </div>
    );
  }

  // `/` redirects rather than rendering the default tab, so every view of the
  // dashboard has exactly one address and the URL in the bar is always one that
  // can be copied and sent. The redirect replaces, because `/` and the default
  // tab are the same view and a back button that walked between them would be
  // a dead step. `Switch` returns the same `<Route>` element for every tab, so
  // moving between tabs re-renders `Dashboard` rather than remounting it, which
  // is what keeps the visited-tab cache alive.
  return (
    <Switch>
      <Route path={TAB_ROUTE_PATTERN}>
        {(params) =>
          isTabId(params.tab)
            ? <Dashboard tab={params.tab} />
            : <Redirect to={DEFAULT_TAB_HREF} replace />
        }
      </Route>
      <Route path="/">
        <Redirect to={DEFAULT_TAB_HREF} replace />
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
