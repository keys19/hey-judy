# Hey Judy (test)

An independent development copy of `OscarNi15/pixel-perfect-replica`, restored to source commit `50a76fe`. The original repository and database are unchanged.

## Development

Use Node.js 22.16+ or Node.js 24, and install dependencies with Bun using the existing lockfile:

```sh
bun install --frozen-lockfile
bun run dev --host 127.0.0.1 --port 3000
```

Open http://127.0.0.1:3000/. The development script loads `.env` and optional `.env.local` for the server as well as the browser configuration.

## Independent database

- Supabase project: `Hey Judy (test)` (`yjlakqgflwedadyhzjzj`).
- Region: Ireland (`eu-west-1`).
- Dashboard: https://supabase.com/dashboard/project/yjlakqgflwedadyhzjzj
- The tracked `.env` contains this project's public connection settings and publishable key only.
- The original account, password hash, user ID, two saved memories, and role record were copied. Sign in again using the existing email and password; sessions are separate from the original app.
- Five business tables, their indexes, foreign keys, policies, grants, and functions were copied. The other three business tables were empty. No Storage files or Edge Functions existed to migrate.

## Server secrets

Create a Git-ignored `.env.local` for server-only secrets:

```dotenv
ANTHROPIC_API_KEY=your_anthropic_api_key
```

The agent requires this key. `SUPABASE_SERVICE_ROLE_KEY`, if needed for future admin features, must come from the new project and belong only in `.env.local` or your hosting provider's secret store. Never prefix server secrets with `VITE_`.

In a deployed environment, configure the new project's `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and server secrets at runtime. Auth provider, SMTP, and redirect configuration are project settings rather than database rows; configure these separately if deploying beyond the current local email/password flow.

## Checks

```sh
bun run test
bun run build
```

Migration verification on 2026-10-14 compared every copied row, including password hashes, and checked the schema and permissions. An authenticated owner could read the two memories; a different user could read none. The source database was accessed with read-only queries.
