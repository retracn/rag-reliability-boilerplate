import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { Foundry, FoundryError } from 'delta-sync-sdk';

const APIFY_TOKEN = process.env.APIFY_TOKEN;
if (!APIFY_TOKEN) throw new Error('APIFY_TOKEN is required — see .env.example');

const foundry = new Foundry({
    apifyToken: APIFY_TOKEN,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    webhookSecret: process.env.WEBHOOK_SECRET,
});

const schema = z.object({
    sources: z.array(z.string().url()).min(1).describe('Source URLs to ingest and produce a critic-verified answer from.'),
    mode: z
        .enum(['structured', 'narrative'])
        .optional()
        .describe('"structured" returns keyFacts + citedChunkIds; "narrative" returns prose. Defaults to "structured".'),
});

/**
 * Description is optimized for an agent's tool-selection step, not human
 * documentation: it states the failure mode this tool exists to prevent and
 * the exact condition under which its output is trustworthy, since an agent
 * chaining this into a larger answer needs that to decide whether to surface
 * the result or discard it.
 */
export const ragReliabilityTool = new DynamicStructuredTool({
    name: 'run_rag_reliability_pipeline',
    description:
        'Deterministic RAG validation and critic orchestration. Intercepts unstructured LLM extraction output derived from external URLs, ingests source content with content-addressed chunking, and validates the extraction against retrieved context via a non-LLM critic (coverage_ratio, schema_compliance, output_bounds, determinism_self_test). Triggers when: RAG hallucination, unsupported claims, vacuous/empty extraction, or ungrounded output must be blocked before an answer is presented as fact. Returns JSON; "synthesis.status" is authoritative: "ok" = passed all critic checks, safe to present. "critic_rejected" = failed grounding validation, MUST NOT be presented as fact. No automatic correction is performed on rejection — this tool detects and blocks, it does not regenerate or fix output. Not applicable to tasks without external-source retrieval and verification.',
    schema,
    func: async ({ sources, mode }) => {
        try {
            const result = await foundry.run({ sources }, { mode });
            return JSON.stringify(result);
        } catch (err) {
            const message = err instanceof FoundryError ? `${err.code}: ${err.message}` : String(err);
            return JSON.stringify({ error: message });
        }
    },
});
