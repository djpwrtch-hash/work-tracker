# WorkTracker — Web (frontend)

React 19 + Vite 8 frontend. TypeScript, Tailwind 4, TanStack Query, Socket.IO client,
Recharts for analytics, and `xlsx` / `jspdf` / `docx` for exports.

## Commands

```bash
npm run dev          # Vite dev server on http://localhost:42780 (HMR)
npm run dev:https    # same, but HTTPS with a self-signed LAN cert (needed for geolocation)
npm run build        # production build into web/dist
npm run preview      # preview the production build
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm test             # Vitest
```

## How it is served in normal use

The app runs on a **single origin**: the Express server on port **42780** serves both the
API and this built frontend (`web/dist`). The browser therefore talks to the same origin
for pages, `/api/*` and the Socket.IO connection.

In **dev mode** Vite keeps port 42780 and proxies `/api` and `/socket.io` to the API on
port 42781 (see `web/vite.config.ts` and `web/.env.example`).

## Environment

| Variable | Purpose |
|----------|---------|
| `VITE_API_URL` | Absolute API origin. Leave empty locally to use the page origin. |
| `VITE_API_PORT` | Dev-only proxy target for the API (default `42781`). |
| `WEB_PORT` | Dev server port (default `42780`). |

## Source layout

```
src/
├── pages/        # 23 routed pages (lazy loaded)
├── components/   # shared UI (ErrorBoundary, Toast, ConfirmDialog, uploads, charts)
├── context/      # AuthContext with JWT refresh
├── lib/          # api client, tokenStore, socket, utils, documentTemplates, env, location
└── types/        # shared TypeScript interfaces
```
