# Employee Work Tracker — Server

Express + TypeScript API backed by MySQL 8. The API serves the built React app
(`web/dist`) in production on a single origin.

## Local development

1. Start MySQL 8 and create the database (default `hr`).
2. Copy the example env and set real secrets:

   ```bash
   copy .env.example .env
   ```

   `ADMIN_EMAIL` and `ADMIN_PASSWORD` are used to bootstrap the first director
   account when the `users` table is empty. The password must be at least 12
   characters.

3. Install dependencies from the repository root:

   ```bash
   npm ci
   npm run dev -w server
   ```

   The server runs on `http://127.0.0.1:42780` by default. In production it binds
   `0.0.0.0` unless `HOST` is set.

4. The server creates the schema and applies migrations on startup. To apply them
   without starting the HTTP server:

   ```bash
   npm run db:migrate -w server
   ```

## Tests

```bash
npm test -w server
```

Tests use the `hr_test` database and require a running MySQL 8 instance. Configure
it with `TEST_DB_HOST`, `TEST_DB_PORT`, `TEST_DB_USER`, `TEST_DB_PASSWORD` and
`TEST_DB_NAME` (default `hr_test`) in `server/.env` or the environment.

## Required environment

| Variable | Notes |
|----------|-------|
| `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` | Or a single `DATABASE_URL` (takes precedence) |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Unique, at least 32 characters in production |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Required in production for first-run admin bootstrap |
| `HOST` | `0.0.0.0` in containers/production, `127.0.0.1` for local-only |
| `PORT` | Defaults to `42780`; Railway injects its own value |
| `CORS_ORIGIN` / `APP_URL` | Public origin(s) when served behind a proxy |
| `TRUST_PROXY` | `1` when behind Railway/Cloudflare/nginx |
| `ENABLE_API_DOCS` | `false` in production; `/api-docs` then uses HTTP Basic auth (`admin` / `ADMIN_PASSWORD`) |

See `server/.env.example` for the full list. Uploads default to `uploads/`;
set `UPLOAD_DIR` to a persistent volume (for example `/data/uploads`) in
production.

## API docs

`/api-docs` is enabled by default in development and disabled by default in
production. Set `ENABLE_API_DOCS=true` to expose it in production; the route is
protected by HTTP Basic auth using username `admin` and the configured
`ADMIN_PASSWORD`.

## Email

Email is optional. Set `EMAIL_ENABLED=true` and the `SMTP_*` values to deliver
password-reset and notification email. Without SMTP, email is skipped and in-app
notifications continue to work.

## Backups

`npm run backup -w server` uses `mysqldump` from `PATH` (or `MYSQLDUMP_PATH`) and
reads the same `DATABASE_URL` / `MYSQL_*` settings as the server. Backups are
written to `BACKUP_DIR` (default `backup/`). The server does not schedule
backups; run the command from cron or a platform scheduler.
