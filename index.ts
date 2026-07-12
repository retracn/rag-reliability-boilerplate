import express from 'express';
import type { Request, Response } from 'express';
import { Foundry, FoundryError, verifyWebhookSignature } from 'delta-sync-sdk';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const APIFY_TOKEN = process.env.APIFY_TOKEN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const PUBLIC_URL = process.env.PUBLIC_URL;

if (!APIFY_TOKEN) throw new Error('APIFY_TOKEN is required — see .env.example');
if (!WEBHOOK_SECRET) throw new Error('WEBHOOK_SECRET is required — see .env.example');
if (!PUBLIC_URL) throw new Error('PUBLIC_URL is required — see .env.example');

const foundry = new Foundry({
    apifyToken: APIFY_TOKEN,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    webhookSecret: WEBHOOK_SECRET,
});

const app = express();

/**
 * Webhook receiver. Mounted with express.raw() (not express.json()) because
 * signature verification needs the exact bytes the Orchestrator signed —
 * re-serializing a parsed object is not guaranteed to reproduce them.
 */
app.post('/webhooks/foundry', express.raw({ type: 'application/json' }), (req: Request, res: Response) => {
    const signature = req.header('x-foundry-signature');
    if (!signature) {
        res.status(401).json({ error: 'missing x-foundry-signature header' });
        return;
    }

    const rawBody = req.body.toString('utf8');
    if (!verifyWebhookSignature(rawBody, signature, WEBHOOK_SECRET)) {
        res.status(401).json({ error: 'signature verification failed' });
        return;
    }

    const payload = JSON.parse(rawBody);
    // payload is a critic-passed SynthesizeResult, delivered only after the
    // Critic verified it — no further hallucination check needed here.
    console.log(`[webhook] verified delivery for manifest ${payload.manifestId}`);
    res.status(200).json({ received: true });
});

app.use(express.json());

/** Trigger endpoint: kicks off sync -> synthesize -> deliver via one run() call. */
app.post('/trigger', async (req: Request, res: Response) => {
    const sources: unknown = req.body?.sources;
    if (!Array.isArray(sources) || sources.length === 0 || !sources.every((s) => typeof s === 'string')) {
        res.status(400).json({ error: 'body must include a non-empty "sources" array of strings' });
        return;
    }

    try {
        const result = await foundry.run(
            { sources },
            {
                mode: req.body?.mode === 'narrative' ? 'narrative' : 'structured',
                webhookUrl: `${PUBLIC_URL}/webhooks/foundry`,
            },
        );
        res.status(202).json({
            manifestId: result.manifestId,
            synthesisStatus: result.synthesis.status,
            delivered: result.delivery?.delivered ?? false,
        });
    } catch (err) {
        if (err instanceof FoundryError) {
            res.status(502).json({ error: err.code, message: err.message });
            return;
        }
        throw err;
    }
});

app.listen(PORT, () => {
    console.log(`rag-reliability-boilerplate listening on :${PORT}`);
    console.log(`  POST /trigger           { "sources": ["https://..."] }`);
    console.log(`  POST /webhooks/foundry  <- receives HMAC-signed, Critic-verified results`);
});
