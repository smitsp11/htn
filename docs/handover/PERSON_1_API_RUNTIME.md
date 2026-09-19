# Person 1 — Federato API runtime

## Your mission

Make communication with Federato reliable and observable. Deliver raw schema/query results and pagination metadata without interpreting underwriting meaning.

## Read first

- `CLAUDE.md`
- `docs/HANDOVER.md`
- `documents/STUDENT_PROJECT_GUIDELINES.pdf`, especially auth, FAQ, and query pitfalls
- `lib/federato/client.ts`
- `.env.example`

## Owned code

- `lib/federato/client.ts`
- New transport/auth/error helpers under `lib/federato/`
- New `app/api/federato/status/` route
- New `components/source-status/` component and local styles
- `tests/federato-client.test.ts`
- Transport fixtures under `tests/fixtures/federato/`

Do not edit `lib/federato/adapter.ts`, appetite logic, the dashboard, or shared domain contracts.

## Build

1. Complete the organizer-specified client-credentials request while preserving the required `auth.product.federato.ai` domain.
2. Cache tokens using `expires_in`, with safe early refresh; the documentation says tokens last four hours.
3. Implement typed `schema` and `query` calls through the supplied handler.
4. Implement pagination that proves all available records were retrieved and does not assume the first page contains the full 50+ queue.
5. Add bounded timeouts and useful errors for 401, rate/transport failures, malformed JSON, and partial pagination.
6. Expose a safe status result for the shared UI: configured, authenticated, schema reachable, last successful request, and record/page counts. Never expose secrets or access tokens.
7. Test token caching/renewal, request bodies, pagination termination, and failures with mocked fetch responses.

## Decisions you own

- Exact OAuth audience/body once organizer documentation is available.
- Token refresh safety window.
- Pagination termination and duplicate-page protection.
- Retryable versus terminal failures.
- Transport metadata required to prove completeness.

You do not decide resource names, field mappings, scoring, or what an underwriter should do.

## Interface promised to others

Person 2 must be able to request:

- One schema response.
- One query page using an opaque payload.
- All pages through a transport-level pagination helper once the pagination contract is known.
- Safe diagnostics that distinguish authentication, query, and transport failures.

Keep raw API objects opaque. Person 2 owns their meaning.

## Completion evidence

- Tests cover token reuse, expiry, failed authentication, successful schema request, multi-page retrieval, and duplicate/partial page protection.
- No credential appears in client components, logs, fixtures, or errors.
- Typecheck, complete test suite, and production build pass.
- Handoff states any organizer-specific values still missing.
