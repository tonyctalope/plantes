# CLAUDE.md

Household plant tracker: Hono server + SQLite + React PWA, with a built-in OAuth 2.1 authorization server so Claude
(remote MCP connector or Claude Code) can add plants from photos. Plants are added **only** through MCP; the web app
has no add form on purpose.

## Commands

```bash
npm run dev          # API on :8787 (node --watch, reads .env)
npm run dev:web      # Vite on :5173, proxies API paths to :8787
npm test             # vitest (test/*.test.ts)
npm run typecheck    # tsc for the server (tsconfig.json) and the web app (web/tsconfig.json)
npm run build        # web app → dist/web
npm run format       # prettier
```

Use Node 26 (`engines`). On Tony's machine `/usr/bin/node` is v22: prefix `PATH=$HOME/.local/share/mise/installs/node/26.13.0/bin:$PATH`.

## Architecture

- `src/main.ts` boots config → SQLite → app → background jobs. `src/app.ts` wires routes; order matters: `/mcp` and
  `/.well-known/*` are registered before the session middleware (bearer-only, no cookies).
- The server runs **TypeScript directly** (Node type stripping): only erasable syntax (no enums, no parameter
  properties, no namespaces), relative imports end in `.ts`, type-only imports use `import type`.
- `src/db/` — `node:sqlite`, append-only `MIGRATIONS` (PRAGMA user_version), tiny `get/all/run` helpers with named
  params. `transaction()` callbacks must be synchronous.
- `src/plants/` — `schema.ts` (zod, field names = column names, descriptions are what Claude reads), `store.ts`
  (SQL + mapping to `shared/api.ts` types), `schedule.ts` (watering due dates: local calendar days, two seasonal
  intervals, snooze), `photos.ts` (sharp: auto-orient, strip metadata, WebP + thumbnail; upload capability links).
- `src/mcp/` — `server.ts` builds a fresh `McpServer` per request (SDK v2, `createMcpHandler`, serves both 2025-era
  and 2026-07-28 clients); `http.ts` gates it with `requireBearerAuth` + our token verifier.
- `src/oauth/` — authorization server: `clients.ts` (DCR restricted to `OAUTH_REDIRECT_HOSTS` + loopback; CIMD only
  from `OAUTH_CIMD_HOSTS`), `tokens.ts` (pending requests bound to the browser session, codes, grants, rotating
  refresh tokens with 60 s reuse grace), `routes.ts` (authorize, consent, token, revoke, register).
- `src/auth/` — Google OIDC via openid-client, sessions (hashed ids, `__Host-` cookie), allowlist re-checked on
  every request.
- `src/push/` — Web Push (VAPID keys from env or generated into `app_settings`), daily reminders per member.
- `shared/api.ts` — JSON contract between `src/api/routes.ts` and `web/src`. Change it there first.
- `web/` — React 19 + Tailwind 4 PWA, hand-written service worker `web/public/sw.js`.

## Invariants (security)

- Secrets (session ids, codes, tokens, upload tokens) are random 256-bit and stored **only as SHA-256 hashes**.
- Never log query strings, Authorization headers or upload tokens (`accessLog` strips them).
- Every state-changing `/api` route relies on the Origin check in `apiRoutes`; keep new routes under it.
- The allowlist (`ALLOWED_EMAILS`) is checked at login, on each session use, on each MCP token use and refresh.
- Server-rendered pages use `hono/html` (auto-escaping) and no JavaScript; the SPA must stay CSP-clean
  (no inline scripts, no external origins).

## Tests

`test/helpers.ts` builds an in-memory app (`setup()`), signs users in (`login()`), and provides `plantFields()` and
`sampleJpeg()`. `test/mcp-e2e.test.ts` drives the official MCP client SDK over real HTTP (DCR + CIMD, both protocol
eras); `test/google-login.test.ts` runs a fake OIDC provider signing RS256 ID tokens.
