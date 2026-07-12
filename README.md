# rag-reliability-boilerplate

Clone this repo to get a production-ready RAG pipeline with deterministic hallucination checks and HMAC-secured delivery built-in. Just add your API key.

## Install

```
npm install
```

## Configure

```
cp .env.example .env
```

Fill in `APIFY_TOKEN`, `ANTHROPIC_API_KEY`, `WEBHOOK_SECRET`, and `PUBLIC_URL` (see comments in `.env.example` for what each does and how to generate `WEBHOOK_SECRET`).

## Run

```
npm start
```

Two routes come up:
- `POST /trigger` — `{ "sources": ["https://..."] }` kicks off `foundry.run()`: ingest → Critic-verified synthesis → signed delivery.
- `POST /webhooks/foundry` — receives the signed result. Verifies the HMAC signature before touching the payload; your downstream agent logic goes in this handler.

## What's actually in here

`index.ts` is ~70 lines: an Express server, one endpoint that calls `delta-sync-sdk`'s `run()`, and one endpoint that verifies and receives the result. No retry logic, no polling loop, no HMAC code to write — that's all inside the SDK.

## Agent-facing surfaces

The same `run()` pipeline is exposed through four integration points, so an agent or agent framework can pick whichever discovery/loading mechanism it already supports instead of you writing an adapter:

- **HTTP** — `POST /trigger` / `POST /webhooks/foundry` (above), described machine-first via [`openapi.yaml`](openapi.yaml) and [`.well-known/ai-plugin.json`](.well-known/ai-plugin.json). Replace the `REPLACE_WITH_YOUR_*` placeholders in both files with your real host/contact/repo before publishing them — they're deliberately left unfilled rather than guessed.
- **MCP** — [`mcp-server.ts`](mcp-server.ts) exposes `run()` as a single MCP tool (`run_rag_reliability_pipeline`) over stdio, for Claude Desktop, Cursor, or any MCP-compliant client. Run it with `npm run mcp`. [`smithery.yaml`](smithery.yaml) is the config to list it on the Smithery registry — format checked against a live, real Smithery-listed server at the time of writing; verify against Smithery's current docs before submitting, since registry schemas can change.
- **LangChain** — [`langchain-tool.ts`](langchain-tool.ts) exports `ragReliabilityTool`, a `DynamicStructuredTool` ready to drop into an agent's tool list.
- **CI/CD** — [`action.yml`](action.yml) is a composite GitHub Action: `uses: automationnation/rag-reliability-boilerplate@v1` with `apify-token`/`sources` inputs runs the full pipeline as a build step, with a `fail-on-critic-rejected` input to gate a pipeline on grounded output.

All four tool/manifest descriptions are written for a model's tool-selection step, not human docs — they state the failure mode being prevented and which output field is authoritative, not what the code does line by line.

## Note on `delta-sync-sdk`'s publish status

`package.json` depends on `delta-sync-sdk@^0.1.0` as it will resolve once published to npm. It is not published yet. Until then, `npm install` above will fail to resolve that dependency. To run this today against the local SDK build:

```
cd ../foundry-sdk && npm run build && npm link
cd ../rag-reliability-boilerplate && npm link delta-sync-sdk
npm install
npm start
```

This is exactly how this boilerplate was smoke-tested (trigger validation, missing-signature rejection, wrong-signature rejection, and valid-signature acceptance all verified against the real HMAC code in the SDK, not a stub). Once `delta-sync-sdk` is on npm, drop the `npm link` steps — `npm install && npm start` alone is the full setup.
