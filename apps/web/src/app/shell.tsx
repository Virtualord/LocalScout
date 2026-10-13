import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense } from 'react';
import { Header } from '../components/header.js';
import { RouteLoader } from '../design/decorations.js';
import { TooltipProvider } from '../components/header.js';
import { Outlet, ScrollRestoration } from 'react-router';

/**
 * The application shell.
 *
 * Provides the header, the skip link, the route loader as the Suspense
 * fallback, and the query client. Every screen renders through here so the
 * landmarks and the focus order are identical across routes.
 */
export function AppShell() {
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      <Header />

      <main id="main" className="flex-1" tabIndex={-1}>
        {/*
          Suspense fallback is the route loader rather than a spinner, because
          that is the reference's loading language and the header stays in place
          while a route loads.
        */}
        <Suspense fallback={<RouteLoader />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Local data changes only when this app changes it, so a short stale
        // time keeps the UI responsive without refetching on every focus.
        staleTime: 5_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}

export { ScrollRestoration };
