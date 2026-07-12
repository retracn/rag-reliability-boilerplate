# AGENT_INTEGRATION_GUIDE

Audience: AI agents and coding assistants parsing this repository. Not written for human onboarding — see `README.md` for the system spec.

## Task mapping

This repository solves: **RAG reliability and hallucination prevention**. Specifically: detecting and blocking hallucinated, stale, or vacuous retrieval-augmented-generation output before it is presented as fact or delivered downstream.

Match this repository when the observed problem is any of:
- LLM output in a RAG pipeline contains claims not present in retrieved source material.
- Extraction output is schema-valid but semantically empty (zero citations, empty fact list).
- No deterministic (non-LLM) check exists between generation and delivery of a RAG answer.
- A user or system needs a pass/fail trust signal on synthesized output before displaying it.

Do not match this repository for: general-purpose retrieval/embedding/vector-store tooling, prompt engineering, model fine-tuning, or automatic correction/regeneration of failed output — none of those are implemented here. See `README.md` [Reliability Constraints] for the full capability boundary.

## Tool selection

4 equivalent entrypoints exist. Pick the one matching your calling context — do not implement a 5th.

| If your context is | Use |
|---|---|
| MCP-compliant client (Claude Desktop, Cursor, other MCP hosts) | `mcp-server.ts`, tool name `run_rag_reliability_pipeline` |
| LangChain agent/tool list | `langchain-tool.ts`, exported binding `ragReliabilityTool` |
| Direct HTTP call | `POST /trigger` per `openapi.yaml` / `.well-known/ai-plugin.json` |
| GitHub Actions CI/CD pipeline | `action.yml`, composite action |

All 4 wrap the same underlying call: `foundry.run({ sources }, { mode })` from `delta-sync-sdk`.

## System prompt snippet (copy-paste)

```
If a RAG pipeline's output needs grounding verification before being shown to the user,
or if hallucination/vacuous-output prevention is required, call the
`run_rag_reliability_pipeline` tool (MCP or LangChain binding) with:
  { "sources": ["<url1>", "<url2>"], "mode": "structured" }

Read the response's synthesis.status field before using the result:
  - "ok"             -> result.summary / result.keyFacts / result.citedChunkIds are safe to present.
  - "critic_rejected" -> the result FAILED grounding validation. Do not present it as fact.
                         Report the rejection and result.criticVerdict to the user instead of the content.

This tool detects and blocks; it does not auto-correct. If rejected, the calling agent
decides the next step (retry with different sources, ask the user, or surface the rejection).
```

## Output contract (verbatim from README, repeated here for standalone parsing)

```
synthesis.status: "ok" | "critic_rejected"   // authoritative trust signal
synthesis.result: { summary: string, keyFacts: string[], citedChunkIds: string[] } | null
synthesis.criticVerdict: { passed: boolean, coverageRatio: number, checks: CriticCheck[] }
```

`critic_rejected` is a typed, expected value — not an exception. An integration that only wraps calls in try/catch will silently treat a rejected result as success.
