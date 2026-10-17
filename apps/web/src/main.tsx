import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { AppProviders, AppShell } from './app/shell.js';
import { Home } from './features/home/index.js';
import { LeadsScreen } from './features/leads/index.js';
import { DashboardScreen } from './features/dashboard/index.js';
import { RunsScreen } from './features/runs/index.js';
import { SettingsScreen } from './features/settings/index.js';
import { NotFound } from './features/not-found/index.js';
import './design/global.css';

/**
 * Routes.
 *
 * Created once outside the React tree, which is what react-router's data mode
 * expects. The modal on `/leads` is driven by a query parameter rather than a
 * separate route, so a lead link is shareable and the browser back button
 * closes the modal rather than leaving the list.
 */
const router = createBrowserRouter([
  {
    path: '/',
    Component: AppShell,
    children: [
      { index: true, Component: Home },
      { path: 'leads', Component: LeadsScreen },
      { path: 'dashboard', Component: DashboardScreen },
      { path: 'runs', Component: RunsScreen },
      { path: 'settings', Component: SettingsScreen },
      { path: '*', Component: NotFound },
    ],
  },
]);

const container = document.getElementById('root');
if (container === null) {
  throw new Error('Missing #root element. Check index.html.');
}

createRoot(container).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
