import { Router, Request, Response } from 'express';
// TODO: uncomment when frontend auth is re-wired (App.tsx passes user={null} currently)
// import { requireAuth } from '../middleware/requireAuth.js';

const router = Router();

// POST /api/ai/callout
// Proxies callout generation to Anthropic so the API key never reaches the browser.
// Body: { whatHappening, whyMatters, action, actionNote? }
// Returns: { stat, headline, body }
router.post('/callout', /* requireAuth, */ async (req: Request, res: Response) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured on the server.' });
    return;
  }

  const { whatHappening, whyMatters, action, actionNote } = req.body as {
    whatHappening?: string;
    whyMatters?: string;
    action?: string;
    actionNote?: string;
  };

  if (!whatHappening || !whyMatters || !action) {
    res.status(400).json({ error: 'whatHappening, whyMatters, and action are required.' });
    return;
  }

  const prompt = `You are writing a callout panel for a business presentation slide. Given this insight story about a shipping/logistics data chart:

What's happening: ${whatHappening}
Why it matters: ${whyMatters}
Recommended action: ${action}${actionNote ? `\nNotes: ${actionNote}` : ''}

Return a JSON object with exactly these three fields:
- "stat": The single most important number, percentage, or metric (max 8 characters, e.g. "92%", "+$45K", "3.2×", "↑18%"). If no clear metric exists, use a short impactful word like "ALERT" or "STRONG".
- "headline": A 3-6 word headline summarizing the key insight (title case, no period)
- "body": One concise supporting sentence, max 55 characters

Return ONLY valid JSON, no other text.`;

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({})) as { error?: { message?: string } };
      res.status(upstream.status).json({ error: err.error?.message ?? `Anthropic error ${upstream.status}` });
      return;
    }

    const data = await upstream.json() as { content: { text: string }[] };
    const raw = data.content[0].text.trim();
    // Strip markdown code fences if present
    const clean = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    const callout = JSON.parse(clean);
    res.json(callout);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error';
    res.status(500).json({ error: message });
  }
});

export default router;
