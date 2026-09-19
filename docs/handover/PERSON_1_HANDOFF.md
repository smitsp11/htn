# Person 1 handoff — Federato API runtime

Status: complete against the brief in `PERSON_1_API_RUNTIME.md`. Typecheck, the full suite (154 tests total; 15 owned), and the production build pass. Live calls are still blocked only on the organizer OAuth **audience** (see blockers).

## Changed files

- `lib/federato/client.ts` — refactored onto the helpers below. **Frozen contract preserved**: `FederatoClient` still exposes `getSchema(): Promise<unknown>` and `query(payload): Promise<unknown>`. Added optional constructor deps (`fetchImpl`, `tokenCache`, `timeoutMs`) for testing, a shared module-level token cache, and a new `queryAll(basePayload, options)` pagination method.
- `lib/federato/token-cache.ts` — new. `TokenCache` with injectable clock, `reset()`, and a configurable early-refresh window (default 5 min before the ~4h expiry). Stores only the opaque token.
- `lib/federato/transport.ts` — new. `fetchJson` with a bounded `AbortController` timeout and `FederatoTransportError` carrying a `category` (`auth | transport | malformed | timeout | pagination`). Error text is built only from HTTP status/body — never the token or credentials.
- `lib/federato/pagination.ts` — new. `fetchAllPages` follows a cursor to exhaustion with a repeated-cursor loop guard, a `maxPages` ceiling, and optional `dedupeKey` duplicate detection.
- `lib/federato/status.ts` — new. Secret-free `SourceStatus` snapshot + recorder + `resetStatus()` test hook.
- `app/api/federato/status/route.ts` — new. `GET` returns the status JSON; `dynamic = "force-dynamic"`.
- `components/source-status/` — new. `SourceStatusPanel` (server-renderable, no CSS import), `source-status.css` (`src-` prefixed), `index.ts` (loads the CSS).
- `tests/federato-client.test.ts` — new. 15 tests.
- `tests/fixtures/federato/transport.ts` — new. Fetch/Response fakes and sentinel credentials.

## Decisions and assumptions

- **Pagination contract is undocumented.** Designed against an assumed envelope (records under `data`/`results`/`items`/`records`; next pointer at `pagination.nextCursor` with fallbacks; `hasMore:false` stops). All overridable via `queryAll(..., { extract, withCursor, dedupeKey, maxPages })`. Field names are marked assumptions, not authoritative Federato names — Person 2 supplies the real shape.
- Early-refresh window 5 min; token TTL fallback 14400s when `expires_in` is absent; request timeout 15s.
- 401/403 → `auth`; other non-OK → `transport`; unparseable body → `malformed`.
- No credential or token string ever appears in an error, log, fixture, or the serialized status (asserted in tests).

## Env vars

No new vars. Existing `FEDERATO_*` vars are used as-is; `FEDERATO_AUDIENCE` remains optional in code but is **required by the server** for live auth.

## Blockers / integration notes

- **Live auth needs the OAuth `audience`** (organizer/Notion value). Without it the token endpoint returns `access_denied` ("No audience parameter provided"). Everything else is wired; set `FEDERATO_AUDIENCE` in `.env.local` and flip `FEDERATO_USE_DEMO_DATA=false` to go live.
- Dashboard owner: render `import { SourceStatusPanel } from "@/components/source-status"` and fetch the snapshot from `GET /api/federato/status`. It can replace the placeholder `components/dashboard/source-status.tsx`.
- Person 2: call `client.queryAll(payload, options)` for full-queue retrieval and pass the real `extract`/`withCursor` once the live pagination shape is known.
