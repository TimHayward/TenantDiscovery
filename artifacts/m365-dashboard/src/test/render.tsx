import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { ThemeProvider } from "next-themes";
import type { ReactElement, ReactNode } from "react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Renders a component with the providers `App.tsx` mounts, and a router whose
 * history lives in memory rather than in the jsdom document.
 *
 * The React Query client is new for every render. Sharing one across a file
 * makes the second test in it depend on what the first one cached, which is the
 * classic way a suite passes in order and fails alone.
 */

function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // A failing request must surface as an error on the first response, not
        // after three silent retries the test then has to wait out.
        retry: false,
        // The application sets 60s. A test that asserts on a refetch would
        // otherwise be served from cache and see nothing happen.
        staleTime: 0,
        gcTime: 0,
      },
      mutations: { retry: false },
    },
  });
}

export interface RenderWithProvidersOptions extends Omit<RenderOptions, "wrapper"> {
  /** The path the in-memory router starts at. */
  path?: string;
  /** Supply a client to inspect the cache, or to share one across a rerender. */
  queryClient?: QueryClient;
}

export interface RenderWithProvidersResult extends RenderResult {
  queryClient: QueryClient;
  /** Drive the in-memory router directly, as `useLocation` would. */
  navigate: (to: string) => void;
  /** Every path the router has been at, oldest first. */
  history: readonly string[];
}

export function renderWithProviders(
  ui: ReactElement,
  { path = "/", queryClient = testQueryClient(), ...options }: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  const { hook, navigate, history } = memoryLocation({ path, record: true });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <Router hook={hook}>{children}</Router>
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    );
  }

  const result = render(ui, { wrapper: Wrapper, ...options });
  return { ...result, queryClient, navigate, history };
}
