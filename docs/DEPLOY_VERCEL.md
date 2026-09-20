# Deploying to Vercel (live mode)

Runbook for hosting the Federato underwriting agent on Vercel in **live** mode:
live Federato data, the OpenAI ask layer on, and live Browserbase consolidation.

## Framework / build

Auto-detected as Next.js 16 (App Router). No `vercel.json` needed. Node 24 (default).

- Build command: `next build`
- Function timeouts are set in code: `rankings` 120s, `ask`/`consolidate` 60s.
- `next.config.ts` force-includes `raw/**` into the API function bundles via
  `outputFileTracingIncludes` — required because the routes read the captured
  Federato snapshot + FEMA enrichment from `raw/` at request time. Do not remove.

## Environment variables

Set these in the Vercel project (Settings → Environment Variables, or the CLI
below). Mark the four **secret** rows as Sensitive and scope them to **Preview +
Production only** — never expose the Federato client secret in a shared/dev value.

### Required (live mode)

| Var | Type | Value |
|---|---|---|
| `FEDERATO_USE_DEMO_DATA` | config | `false` |
| `FEDERATO_API_URL` | config | `https://product.federato.ai/integrations-api/handlers/federato-hack-north?outputOnly=true` |
| `FEDERATO_AUTH_URL` | config | `https://auth.product.federato.ai/oauth/token` |
| `FEDERATO_CLIENT_ID` | **secret** | from Federato organizer credentials |
| `FEDERATO_CLIENT_SECRET` | **secret** | from Federato organizer credentials |
| `FEDERATO_AUDIENCE` | **secret** | from Federato credentials (not printed in the PDFs) |
| `OPENAI_API_KEY` | **secret** | powers the ask-the-queue layer |
| `BROWSERBASE_API_KEY` | **secret** | live consolidation demo |
| `BROWSERBASE_PROJECT_ID` | config | Browserbase project id |

### Optional

| Var | Default | When |
|---|---|---|
| `OPENAI_MODEL` | `gpt-4.1` | override ask model |
| `FEDERATO_PLANNER_PROVIDER` | unset (off) | enable LLM schema planner (`openai`\|`anthropic`) |
| `FEDERATO_PLANNER_MODEL` | provider default | with the planner |
| `ANTHROPIC_API_KEY` | — | only if planner provider is `anthropic` |
| `FEDERATO_DISABLE_LLM_PLANNER` | unset | force-off the planner |

## CLI setup

```bash
npm i -g vercel@latest          # CLI is currently outdated
vercel link                     # link this repo to a Vercel project

# Non-secret config (Production + Preview):
vercel env add FEDERATO_USE_DEMO_DATA production   # false
vercel env add FEDERATO_API_URL production
vercel env add FEDERATO_AUTH_URL production
vercel env add BROWSERBASE_PROJECT_ID production

# Secrets (repeat for `preview` if you want protected previews to work):
vercel env add FEDERATO_CLIENT_ID production
vercel env add FEDERATO_CLIENT_SECRET production
vercel env add FEDERATO_AUDIENCE production
vercel env add OPENAI_API_KEY production
vercel env add BROWSERBASE_API_KEY production

vercel                          # preview deploy — smoke test first
vercel --prod                   # promote to production
```

## Post-deploy smoke test

1. `GET /api/federato/status` → confirms live auth + reachability.
2. `GET /api/rankings` → returns the ranked queue (verifies `raw/` enrichment
   loaded inside the function; a "Missing offline snapshot" error means the
   `outputFileTracingIncludes` change was lost).
3. `POST /api/ask` `{ "question": "..." }` → grounded answer (verifies OpenAI key).
4. Trigger consolidation in the UI → live Browserbase run (verifies Browserbase creds).

## Notes

- The `raw/` snapshot is still read even in live mode: FEMA enrichment
  (`raw/enrichment.json`), context (`raw/context.json`), and the consolidation
  index (`raw/consolidation.json`) are a separate decision-support layer.
- `playwright-core` connects to Browserbase over CDP (`chromium.connectOverCDP`);
  no local Chromium is launched, so no `@sparticuz/chromium` bundling is needed.
- Motion/animation speed is currently hardcoded per-component in CSS with a
  `prefers-reduced-motion` fallback in `app/globals.css`. Central `--motion-scale`
  control was deferred (chose hosting-only scope).
