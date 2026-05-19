import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "next-themes";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import OnboardingPage from "@/pages/OnboardingPage";
import { getOnboardingStatus } from "@/lib/onboardingApi";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
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

  return (
    <Switch>
      <Route path="/" component={Dashboard} />
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
