import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryProvider } from '@/components/QueryProvider';
import { AuthProvider } from '@/context/AuthContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ToastProvider } from '@/components/Toast';
import { ConfirmProvider } from '@/components/ConfirmDialog';
import SplashScreen from '@/components/SplashScreen';
import RouteLoadingIndicator from '@/components/RouteLoadingIndicator';
import AppRoutes from './routes';
import './globals.css';

// One-time cleanup of the legacy Next.js/Workbox service worker. It precached
// /_next/* paths that no longer exist and could serve stale chunks after an
// upgrade. public/sw.js is now a self-unregistering kill switch; this also
// removes the registration immediately for clients that already loaded the app.
try {
  if (!localStorage.getItem('wt-sw-cleanup-v1')) {
    localStorage.setItem('wt-sw-cleanup-v1', '1');
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
        .catch(() => {});
    }
    if ('caches' in window) {
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .catch(() => {});
    }
  }
} catch {
  // localStorage/caches unavailable (private mode, old browser) — ignore.
}

export default function MainApp() {
  return <AppRoutes />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary>
        <QueryProvider>
          <AuthProvider>
            <SplashScreen>
              <RouteLoadingIndicator />
              <ToastProvider />
              <ConfirmProvider>
                <MainApp />
              </ConfirmProvider>
            </SplashScreen>
          </AuthProvider>
        </QueryProvider>
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>,
);
