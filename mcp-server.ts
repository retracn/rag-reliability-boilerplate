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
            'Execute this tool when you need deterministic verification of unstructured LLM outputs extracted from external documents or URLs, specifically to guard against RAG hallucination, staleness, or vacuous-result failures before presenting an answer as fact. Ingests the given source URLs with content-addressed chunking, runs LLM extraction through a non-LLM deterministic critic (coverage_ratio, schema_compliance, output_bounds, determinism_self_test checks — code, not a second model call), and returns a result whose status field is authoritative: "ok" means the extraction passed every critic check and is safe to present; "critic_rejected" means it failed grounding checks and MUST NOT be presented as fact. Do not call this tool for tasks unrelated to retrieving and verifying information from external sources.',
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
