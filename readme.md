# Employee Work Tracker

[![CI](https://github.com/PowerTechConsultants/Work-Tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/PowerTechConsultants/Work-Tracker/actions/workflows/ci.yml)

A production-grade full-stack workforce management application for small to medium teams (30-35 employees). Replaces manual spreadsheets with a centralized system for attendance, tasks, leaves, work plans, reports, and analytics.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Node.js 22+, Express 4.x, TypeScript, mysql2 (MySQL) |
| **Database** | MySQL 8.0 via `mysql2/promise`. `server/src/db/schema.sql` is the source of truth (migrations 1-20 are idempotent). |
| **Deployment** | Docker (localhost) / PM2 |

## Quick Start (localhost)

### Prerequisites
- Node.js 22+
- npm 9+
- MySQL 8.0 running locally (Windows service `MySQL80`)

### One-click run (recommended)

1. Start MySQL once: `net start MySQL80` (Administrator) or `services.msc` → start **MySQL80**
2. Run `START.bat`

The script checks MySQL, starts the app on the single stable port **42780**
(API + built frontend on one origin), waits until the database is ready, and opens
**http://localhost:42780**. Use `STOP.bat` to stop everything.

To see code changes on that port, rebuild the frontend: `npm run build -w web`.
For instant hot reload while editing, use dev mode — it keeps the same URL:

```bash
npm run dev
```

### Stopping the app

The app runs until **you** stop it. Nothing else ends it (no OS watchdog, no idle-killer):

- press `Ctrl+C`, run `STOP.bat`, or shut down Windows
- `STOP.bat` asks the server to shut down gracefully (token-guarded `POST /internal/stop`)
  and only force-terminates as a fallback

Server output is mirrored to `%TEMP%\wt-api.log`.

### Manual run

```bash
npm install
copy server\.env.example server\.env    # set MYSQL_PASSWORD, JWT secrets, ADMIN_*
npm run setup                           # create schema + first admin
npm run build                           # build the frontend served on 42780
npm start                               # or: node server.js
```

`npm start` runs from the repo root but loads `server/.env` (and then a root `.env` if
present), so the copy step above is enough. `npm run start -w server` works too.

- **App:** http://localhost:42780
- **Backend API:** http://localhost:42780/api/v1
- **Health Check:** http://localhost:42780/health
- **Readiness (DB):** http://localhost:42780/ready
- **API Docs:** http://localhost:42780/api-docs (HTTP Basic auth: `admin` / `ADMIN_PASSWORD`)



## Project Structure

```
employee-work-tracker/
├── server/                       # Backend API (Express + TypeScript)
│   ├── src/
│   │   ├── app.ts                # Express app setup
│   │   ├── server.ts             # Entry point with graceful shutdown
│   │   ├── middleware/           # Auth, RBAC, validation, compression, caching
│   │   ├── lib/                  # Config, JWT, time utils, auto-absent, socket, backup
│   │   ├── db/                   # MySQL pool, transactions, schema, migrations, bootstrap
│   │   ├── modules/              # 17 feature modules (auth, attendance, tasks, files, security, etc.)
│   │   └── types/                # TypeScript type definitions
│   ├── tests/                    # Frontend Vitest tests
│   ├── load-tests/               # Artillery load tests
│   └── package.json
├── web/                          # Frontend (React 19 + Vite 8)
│   ├── src/
│   │   ├── pages/                # 23 page routes (React Router)
│   │   ├── components/           # Shared UI components (ErrorBoundary, Toast, ConfirmDialog)
│   │   ├── context/              # AuthContext with JWT refresh
│   │   ├── lib/                  # API client, socket, utils, location, env
│   │   └── types/                # TypeScript interfaces for API responses
│   └── package.json
├── .github/workflows/ci.yml     # CI/CD pipeline
├── ecosystem.config.js           # PM2 process management
└── package.json                  # Root workspace config
```

## Features

### Core Modules (17 modules, ~90 API endpoints)

| Module | Description |
|--------|-------------|
| **Auth** | JWT login/register, refresh token rotation, password reset, account lockout |
| **Attendance** | Check-in/out, pause/resume, geolocation, auto-absent scheduler, overtime detection |
| **Tasks** | CRUD with assignments, comments, approvals, progress tracking, statistics |
| **Work Plans** | Daily planning with submission and manager review workflow |
| **Work Reports** | End-of-day reports with feedback and blockers tracking |
| **Leaves** | Application, approval, cancellation, balance tracking, working-day calculation |
| **Documents** | Employee requests for appointment letters, experience/internship/leaving certificates and salary slips; HR/Admin fill a boilerplate template and issue; auto-generated PDF/Word download with notifications |
| **Employee Database** | Admin/HR-only employee-wise master record: full profile data plus every official letter issued to each employee, with in-page issue workflow and PDF/Word downloads |
| **Departments** | CRUD with manager assignment, employee count |
| **Roles** | Role master (director/HR only). Custom roles inherit one access level (`director`, `hr`, `employee`); system roles are protected. |
| **Teams** | Team management with member add/remove, leader designation |
| **Users** | Full CRUD with role-based access, employee ID generation |
| **Holidays** | Company-wide and per-user holiday assignment |
| **Notifications** | Real-time via Socket.IO, mark-read, bulk operations |
| **Activity Logs** | Complete audit trail for all entity changes |
| **Analytics** | Attendance trends, department stats, leave usage, task summary |
| **System** | DB overview, WAL-safe backups, health/readiness probes |
| **Files** | Upload/download with type and size validation, storage provider switch (local/S3) |
| **Security** | Password policy, 2FA (TOTP), session/token management |

### Security Features

- **JWT Rotation:** Access token (15min) in memory, refresh token (30d) in httpOnly cookie
- **RBAC:** Director, HR, Employee access levels with per-endpoint enforcement. Role names are managed in the Roles master and map to one of those access levels.
- **Rate Limiting:** Global, write, auth-specific limits with MySQL persistence
- **Account Lockout:** 5 failed attempts → 15-minute lockout
- **Password Reset:** One-time use tokens with 1-hour expiry
- **Circuit Breaker:** bcrypt failure protection
- **Security Headers:** Helmet (CSP, XSS, HSTS)
- **CORS:** Configurable origins with credentials
- **IDOR Prevention:** Users can only access their own data

### Dependency Notes

- `xlsx` (Excel export) has two open advisories with **no npm fix available** (SheetJS
  publishes fixes outside the registry). The app only **writes** workbooks
  (`aoa_to_sheet` / `book_append_sheet` / `writeFile` in `web/src/lib/utils.ts`) and never
  parses a workbook, so the affected parsing code paths are unreachable. Plan: replace with
  `exceljs` when convenient.
- `tar` is pulled in by `bcrypt`'s build toolchain (`@mapbox/node-pre-gyp`) and is
  install-time only. It is pinned to a patched release via the `overrides` entry in
  `package.json`.

### UI Features

- **Dark theme** with consistent design language
- **Responsive design** (mobile sidebar, flexible layouts)
- **Real-time updates** via Socket.IO
- **Toast notifications** for all operations
- **Custom confirmation dialogs** for destructive actions
- **CSV/Excel/PDF export** with column picker
- **Geolocation capture** on check-in
- **Calendar integration** for attendance and leaves
- **Advanced filtering** with date ranges and multi-select
- **Optimistic UI updates** for instant feedback

## Available Scripts

### Root

| Command | Description |
|---------|-------------|
| `npm run dev` | Start both backend + frontend |
| `npm run build` | Production build |
| `npm start` | Production start |
| `npm run lint` | Lint both packages |
| `npm run typecheck` | Type check backend |
| `npm test` | Run all tests (server + web) |
| `npm run setup` | Create schema, apply migrations, seed first admin |
| `npm run backup` | Manual backup |
| `npm run backup:list` | List backups |

### Backend (`server/`)

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server with hot reload (`tsx watch src/server.ts` on :42781) |
| `npm run build` | TypeScript compilation (`tsc -p tsconfig.build.json`) |
| `npm test` | Vitest (37 tests, 7 files, ≥35% line coverage enforced) |
| `npm run test:watch` | Watch mode |
| `npm run test:coverage` | Coverage report |
| `npm run lint` | ESLint (`src/**/*.ts`) |
| `npm run typecheck` | TypeScript check |

### Frontend (`web/`)

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server (http://localhost:42780, proxy /api → :42781) |
| `npm run dev:https` | Vite HTTPS for LAN geolocation (trust `web/certs/`) |
| `npm run build` | Production build (`web/dist`, used by Hostinger) |
| `npm run lint` | ESLint |

## API Authentication

```bash
# Login
curl -X POST http://localhost:42780/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@power-tech.group","password":"Admin@123456789"}'

# Authenticated request
curl -X GET http://localhost:42780/api/v1/auth/me \
  -H "Authorization: Bearer <accessToken>"
```

## Testing

```bash
npm run verify        # everything: typecheck, lint, build, unit + API tests, E2E
npm test              # Vitest: server (API/integration) + web (unit)
npm run test:coverage -w server
npm run test:coverage -w web
npm run test:e2e      # Playwright (seeds its own data, uses ports 42790/42791)
npm run test:reset-db # empty the test database by hand
npm run test:load     # Artillery (requires a local install)
```

### Test database

Automated tests never touch the development database. They use a separate `hr_test`
created and **reset before every run** (`server/src/test/global-setup.ts`), so results do
not depend on leftovers from previous runs. Connection settings come from
`server/src/test/test-db.ts`:

| Variable | Default | Purpose |
|----------|---------|---------|
| `TEST_DB_HOST` | `MYSQL_HOST` / 127.0.0.1 | Test database host |
| `TEST_DB_PORT` | `MYSQL_PORT` / 3306 | Test database port |
| `TEST_DB_USER` | `MYSQL_USER` / root | Test database user |
| `TEST_DB_PASSWORD` | `MYSQL_PASSWORD` / *(empty)* | Test database password |
| `TEST_DB_NAME` | `hr_test` | Test database name (protected DBs are refused) |

Locally the values fall back to `server/.env`, so no configuration is needed. In CI they
are set explicitly (see `.github/workflows/ci.yml`).

### E2E

Playwright starts its own API (`:42791`) and Vite server (`:42790`), so it can run while
the real app stays on `:42780`. `web/e2e/global-setup.ts` resets `hr_test` and seeds
`e2e-director@example.com` before the specs run.

### Load tests

```bash
npm run test:load                        # auth scenario
npx artillery run server/load-tests/tasks-load-test.yml
```

## Deployment

The primary supported setup is **localhost** (see Quick Start). Docker Compose and
Railway are supported for hosted deployments; PM2 is available for a plain VM.

### Docker (localhost, no public exposure)

```bash
cp .env.example .env
# edit .env: MYSQL_ROOT_PASSWORD, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, ADMIN_*
docker compose up -d --build
curl -s http://localhost:42780/ready
```

`docker compose up` starts MySQL and the API (which also serves `web/dist` from
`server/Dockerfile`). Stop with `docker compose down`.

### Railway

`railway.json` pins the builder to `server/Dockerfile` and the healthcheck to `/ready`.
The Dockerfile builds the API and `web/dist`, then serves both from one origin, and
installs `mysql-client` for backups.

1. Create a Railway project and add a **MySQL** service. Use a **fresh/empty database**;
   the app creates `schema.sql` and applies migrations 1-20 on first boot.
   Do **not** point `DATABASE_URL` at a copy of an older/newer database (for example a
   local `hr` that already has multi-tenant `org_id` columns or migration 19 from
   another branch) — that schema is not compatible with this code.
2. Add this app service from the repository with root directory = repo root.
   `railway.json` selects `server/Dockerfile`; no Railpack configuration is needed.
3. Set the healthcheck path to `/ready` and replicas to `1`. Set the service target
   port to `42780` to match `PORT` below.
4. Add a volume mounted at `/data` (uploads/backups) and set `RAILWAY_RUN_UID=0` so the
   container user can write to it.
5. Add the environment variables below. `DATABASE_URL` is the only database variable
   required; Railway's MySQL plugin exposes `MYSQL_URL`:

   ```text
   NODE_ENV=production
   HOST=0.0.0.0
   PORT=42780
   SERVE_STATIC=true
   TRUST_PROXY=1
   COOKIE_SECURE=true
   COOKIE_SAME_SITE=strict
   APP_TIMEZONE=Asia/Kolkata
   DATABASE_URL=${{MySQL.MYSQL_URL}}
   JWT_ACCESS_SECRET=<48 random bytes, base64>
   JWT_REFRESH_SECRET=<48 random bytes, base64>
   ADMIN_EMAIL=<admin email>
   ADMIN_PASSWORD=<at least 12 characters, not the default>
   APP_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
   CORS_ORIGIN=https://${{RAILWAY_PUBLIC_DOMAIN}}
   UPLOAD_DIR=/data/uploads
   BACKUP_DIR=/data/backup
   ENABLE_API_DOCS=false
   ```

   Generate the JWT secrets with
   `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`.
   Do **not** set `API_PORT`; it overrides `PORT`. If you use a custom domain, set
   `APP_URL`/`CORS_ORIGIN` to that origin. Keep `COOKIE_SAME_SITE=strict` for the
   single-origin setup; only use `none` (with `COOKIE_SECURE=true`) if you split the
   frontend and API across different sites. `APP_TIMEZONE` controls "today", attendance
   dates and scheduled jobs.

Migrations run automatically on startup. The app is not marked ready until
`schema_migrations` reaches version 20 and the core tables (including `roles`) exist, so a failed
migration fails the Railway healthcheck instead of serving broken requests.

Production email and backups are configuration-gated:

- Set `EMAIL_ENABLED=true` plus `SMTP_*` to deliver password-reset and notification
  email. Without SMTP, those emails are skipped and in-app notifications still work.
- Backups are created on demand by `npm run backup` or the director-only
  `POST /api/v1/system/backup` endpoint. The app does not run a backup cron; use
  Railway cron, a platform scheduler, or an external job against `/data/backup`.
- Set `ENABLE_API_DOCS=true` only when you need Swagger. `/api-docs` then requires
  HTTP Basic auth with username `admin` and the configured `ADMIN_PASSWORD`.

### PM2

```bash
pm2 start ecosystem.config.js   # PORT 42780 (dev) / production
pm2 save
pm2 startup
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | development | Environment mode |
| `PORT` | 42780 | The single app port (API + frontend on one origin); Railway injects it |
| `HOST` | 127.0.0.1 (dev) / 0.0.0.0 (production) | Bind address |
| `API_PORT` | (empty) | Overrides `PORT`; do not set it on Railway |
| `CORS_ORIGIN` | http://localhost:42780 | Allowed CORS origins — set to your public origin when exposed |
| `APP_URL` | http://localhost:42780 | Public app URL used in emails/links |
| `TRUST_PROXY` | 0 | Set to `1` behind Railway/nginx |
| `COOKIE_SECURE` | false (true in production) | Require HTTPS for auth cookies |
| `COOKIE_SAME_SITE` | strict | `strict`, `lax`, or `none`; `none` requires `COOKIE_SECURE=true` |
| `APP_TIMEZONE` | Asia/Kolkata | IANA timezone for business dates/attendance/scheduled jobs |
| `ENABLE_API_DOCS` | false in production | Expose `/api-docs` with HTTP Basic auth (`admin` / `ADMIN_PASSWORD`) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | (empty) | First-run admin bootstrap; required in production |
| `UPLOAD_DIR` | uploads | File storage directory; use a persistent volume in production |
| `BACKUP_DIR` | backup | `mysqldump` output directory |
| `EMAIL_ENABLED` | auto | `true`/`false`; auto-enables when `SMTP_HOST` and `SMTP_USER` are set |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | (empty) | Optional outbound email for password reset and notifications |
| `SERVE_STATIC` | false | Serve `web/dist` from Express |
| `MYSQL_HOST` | localhost | MySQL host |
| `MYSQL_PORT` | 3306 | MySQL port |
| `MYSQL_USER` | root | MySQL user |
| `MYSQL_PASSWORD` | (empty) | MySQL password |
| `MYSQL_DATABASE` | hr | MySQL database name |
| `DATABASE_URL` | (empty) | MySQL connection URL (overrides MYSQL_* vars) |
| `JWT_ACCESS_SECRET` | (auto-generated) | Access token signing key |
| `JWT_REFRESH_SECRET` | (auto-generated) | Refresh token signing key |
| `JWT_ACCESS_TTL` | 15m | Access token expiry |
| `JWT_REFRESH_TTL_DAYS` | 30 | Refresh token expiry (days) |
| `MAX_LOGIN_ATTEMPTS` | 50 | Lockout threshold |
| `LOCKOUT_MINUTES` | 15 | Lockout duration |
| `ENABLE_HTTPS` | false | Self-signed HTTPS |

## Security notes

- `npm audit --omit=dev` reports **0 vulnerabilities** for the deployed dependency tree.
- The frontend uses `xlsx` only to *write* export files (never parses untrusted
  spreadsheets); it is pinned to the patched SheetJS 0.20.3 build from the official CDN.
- Remaining advisories are dev-only (`vitest`/`tinypool`); fixing them requires a major
  test-runner upgrade and does not affect the production image.
- `server/.env` is excluded from Docker/Railway build contexts. Set secrets through the
  platform's environment variables instead.

## License

See `LICENSE` file.
