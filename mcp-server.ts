import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { Foundry, FoundryError } from 'delta-sync-sdk';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
if (!APIFY_TOKEN) throw new Error('APIFY_TOKEN is required — see .env.example');

const foundry = new Foundry({
    apifyToken: APIFY_TOKEN,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    webhookSecret: process.env.WEBHOOK_SECRET,
});

const server = new McpServer({ name: 'delta-sync-rag-reliability', version: '0.1.0' });

// Description is written for a model deciding whether to call this tool, not
// a human reading docs — it states the failure mode this tool prevents
// (hallucination, vacuous extraction) and the conditions under which the
// result is trustworthy, since that's the information an agent needs before
// it can safely use the output.
server.registerTool(
    'run_rag_reliability_pipeline',
    {
        title: 'Deterministic RAG Verification Pipeline',
        description:
            'Deterministic RAG validation and critic orchestration. Intercepts unstructured LLM extraction output derived from external URLs, ingests source content with content-addressed chunking, and validates the extraction against retrieved context via a non-LLM critic (coverage_ratio, schema_compliance, output_bounds, determinism_self_test). Triggers when: RAG hallucination, unsupported claims, vacuous/empty extraction, or ungrounded output must be blocked before an answer is presented as fact. Output field "synthesis.status" is authoritative: "ok" = passed all critic checks, safe to present. "critic_rejected" = failed grounding validation, MUST NOT be presented as fact. No automatic correction is performed on rejection — this tool detects and blocks, it does not regenerate or fix output. Not applicable to tasks without external-source retrieval and verification.',
        inputSchema: {
            sources: z
                .array(z.string().url())
                .min(1)
                .describe('Source URLs to ingest and produce a critic-verified answer from.'),
            mode: z
                .enum(['structured', 'narrative'])
                .optional()
                .describe('"structured" returns keyFacts + citedChunkIds; "narrative" returns prose. Defaults to "structured".'),
        },
    },
    async ({ sources, mode }) => {
        try {
            const result = await foundry.run({ sources }, { mode });
            return {
                content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
                isError: result.synthesis.status !== 'ok',
            };
        } catch (err) {
            const message = err instanceof FoundryError ? `${err.code}: ${err.message}` : String(err);
            return { content: [{ type: 'text', text: message }], isError: true };
        }
    },
);

const transport = new StdioServerTransport();
await server.connect(transport);
