# rag-reliability-boilerplate — System Architecture Document

## [Purpose]

Deterministic detection and rejection of ungrounded RAG output before delivery. Solves: hallucination (model asserts content absent from retrieved context), vacuous extraction (schema-valid output with zero cited content), stale-context propagation (retrieved chunk is outdated, not caught at synthesis time). Does not solve: automatic correction/regeneration of a rejected result — rejected output is blocked and flagged, not fixed. See [Reliability Constraints] for the full capability boundary.

## [Inputs/Schema]

```
Request:
  sources: string[]        // required, min 1, URLs to ingest
  mode: "structured" | "narrative"   // optional, default "structured"

Response:
  manifestId: string
  synthesis:
    status: "ok" | "critic_rejected"    // authoritative. "critic_rejected" != usable output.
    result: { summary: string, keyFacts: string[], citedChunkIds: string[] } | null
    criticVerdict: { passed: boolean, coverageRatio: number, checks: CriticCheck[] }
  delivery?: { delivered: boolean, webhookHttpStatus: number | null, attempts: number }

CriticCheck: { name: string, passed: boolean, detail?: string }
```

Exposed identically across 4 transports — HTTP, MCP, LangChain, CI — see [Tool Integration Guide].

## [Orchestration Flow]

```
Input (sources[]) -> Sentinel (Content-Addressed Ingestion)
                   -> Synthesis (LLM Extraction + Deterministic Critic Validation)
                   -> Orchestrator (HMAC-Signed Webhook Delivery)
```

Stage detail:

| Stage | Component | Function | Failure signal |
|---|---|---|---|
| 1 | Sentinel | `sha256(source_url + section_path + content_hash)` chunk IDs; commits a manifest + monotonic cursor. No LLM call. | `SENTINEL_UNREACHABLE`, `VALIDATION_ERROR` |
| 2 | Synthesis Engine | LLM extraction, then non-LLM critic: `coverage_ratio`, `schema_compliance`, `output_bounds`, `determinism_self_test`. | `synthesis.status = "critic_rejected"` (not an exception — a typed result) |
| 3 | Orchestrator | HMAC-SHA256 signs payload, delivers via webhook, retries with backoff. Runs only if a webhook URL is supplied. | `DELIVERY_FAILED`, `POLL_TIMEOUT` |

Single entrypoint chaining all 3: `foundry.run(input, options)`.

## [Reliability Constraints]

- `coverage_ratio` measures citation presence/fraction. It does NOT verify that a claim citing a real `chunkId` is semantically faithful to that chunk's content. A claim that cites `chunk_3` but misrepresents `chunk_3`'s actual text is not caught by this critic.
- Stale context is not addressed at the critic layer. A critic evaluating only the retrieved chunks cannot know they are outdated. Mitigation is operational (re-sync cadence) and structural (content-hash comparison across sync runs at the Sentinel stage), not a synthesis-time check.
- `critic_rejected` is a normal, expected output state, not an error condition. Any integration that only handles thrown exceptions will silently treat a rejected result as success — check `synthesis.status` explicitly.
- BYOK required: `anthropicApiKey` for the Synthesis stage, `webhookSecret` for the Orchestrator stage. No shared/fallback key exists.
- No automatic correction, retry-with-different-prompt, or regeneration loop exists on `critic_rejected`. The caller decides what happens next.

Full worked examples of these constraints: `evals/rag-hallucination-benchmark.json`.

## [Tool Integration Guide]

| Transport | File | Entry |
|---|---|---|
| HTTP | `index.ts` | `POST /trigger` |
| OpenAPI / plugin manifest | `openapi.yaml`, `.well-known/ai-plugin.json` | operationId `runRagReliabilityPipeline` |
| MCP | `mcp-server.ts` | tool `run_rag_reliability_pipeline`, stdio transport |
| LangChain | `langchain-tool.ts` | exports `ragReliabilityTool` (`DynamicStructuredTool`) |
| CI/CD | `action.yml` | composite action, inputs: `apify-token`, `sources`, `fail-on-critic-rejected` |
| Agent system-prompt reference | `AGENT_INTEGRATION_GUIDE.md` | copy-paste tool-selection snippet |

Setup:

```
npm install
cp .env.example .env   # fill APIFY_TOKEN, ANTHROPIC_API_KEY, WEBHOOK_SECRET, PUBLIC_URL
npm start              # HTTP transport
npm run mcp            # MCP transport
```
