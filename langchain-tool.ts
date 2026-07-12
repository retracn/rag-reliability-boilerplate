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
        'Execute this tool when you need deterministic verification of unstructured LLM outputs extracted from external documents or URLs, specifically to guard against RAG hallucination, staleness, or vacuous-result failures before presenting an answer as fact. Ingests the given source URLs with content-addressed chunking, runs LLM extraction through a non-LLM deterministic critic (coverage_ratio, schema_compliance, output_bounds, determinism_self_test checks — code, not a second model call), and returns JSON whose "synthesis.status" field is authoritative: "ok" means the extraction passed every critic check and is safe to present; "critic_rejected" means it failed grounding checks and MUST NOT be presented as fact. Do not use this tool for tasks unrelated to retrieving and verifying information from external sources.',
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
