# Federato Underwriting Agent

A restrained MVP for ranking commercial-property submissions against Federato's supplied 2025 appetite guidelines. The application is read-only: it recommends what an underwriter should review and never makes or writes back a binding decision.

It does three things: **ingests** submissions (schema discovery + query, or the captured `raw/` snapshot offline), **enriches** each with external risk data (FEMA National Risk Index hazard ratings per location, shown as separate context that never changes the appetite score), and **produces insights** — a ranked, explained queue you can interrogate in plain English ("ask the queue").

## Ask the queue

An underwriter can type natural-language questions ("why is Harbor Point out of appetite?", "show me new-business property in CA under $100M") and the app answers grounded in the deterministic factors — filtering the live queue or explaining a submission. The LLM only interprets the question and phrases the answer; every fact and row comes from the scoring engine. Set `OPENAI_API_KEY` in `.env.local` to enable it.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

By default (no `FEDERATO_USE_DEMO_DATA` set) the app serves the real 158-submission snapshot captured in `raw/`, scored through the same schema-planner + adapter path as live — no credentials needed. Set `FEDERATO_USE_DEMO_DATA=true` for the synthetic fixtures. Open `http://localhost:3000`.

## Connect Federato

1. Add the organizer-provided client ID, secret, and Auth0 audience to `.env.local`.
2. Capture a successful schema response and query using the supplied documentation.
3. Set `FEDERATO_QUERY_PAYLOAD_JSON` to the query's inner `payload` object.
4. If response names differ from the canonical model, set `FEDERATO_FIELD_MAP_JSON`.
5. Set `FEDERATO_USE_DEMO_DATA=false`.

The client already uses the PDF-specified endpoints:

- `POST ...federato-hack-north?outputOnly=true` with `{ "action": "schema" }`
- The same endpoint with `{ "action": "query", "payload": { ... } }`
- Auth against `auth.product.federato.ai` rather than the canonical Auth0 domain

The temporary JSON query seam keeps unknown API details isolated. It must be replaced with a schema-driven query planner for the finished MVP; see [the implementation plan](docs/MVP_PLAN.md).

## Parallel team handover

Start with [`CLAUDE.md`](CLAUDE.md) and [`docs/HANDOVER.md`](docs/HANDOVER.md). Four equal Claude Code assignments, file ownership, decision boundaries, and completion criteria are defined under [`docs/handover/`](docs/handover/).

When using Conductor, create four workspaces from the same commit and assign one numbered brief to each. Repository scripts use concurrent mode and each local workspace receives its own development port.

## Commands

```bash
npm run dev
npm run typecheck
npm test
npm run build
```
