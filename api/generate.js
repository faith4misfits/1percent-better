/**
 * Vercel Serverless Function: /api/generate
 *
 * Acts as a secure proxy between the frontend and the Anthropic API.
 * The API key is stored as an environment variable in Vercel — it is
 * never visible to users of the app.
 *
 * Environment variable required:
 *   ANTHROPIC_API_KEY  — your key from console.anthropic.com
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { goal } = req.body || {};
  if (!goal || typeof goal !== 'string' || goal.trim().length < 3) {
    return res.status(400).json({ error: 'A valid goal is required.' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'The server is not configured yet. Please contact the app owner.',
    });
  }

  const prompt = `You are a world-class personal development coach. The user's 100-day goal is:

"${goal.trim()}"

Design a transformative 100-day journey where each day is one tiny 1% improvement compounding toward the goal. Use this arc:
- Days 1-10: Tiny first steps, pure awareness (5 minutes or less per day)
- Days 11-25: Building micro-habits and foundations
- Days 26-50: Deepening engagement, growing consistency
- Days 51-75: Expanding, stretching, refining the practice
- Days 76-90: Sustained mastery and integration
- Days 91-100: Reflection, celebration, and identity solidification

Rules:
- Every action must be SPECIFIC and directly tied to THIS goal
- Each day must feel meaningfully different from the previous days
- Keep actions achievable, not overwhelming
- Vary the "focus" theme across categories like: mindset, habit, learning, practice, community, reflection, challenge, creativity, rest, milestone
- Write action descriptions in warm second-person
- Day 100 should be a meaningful culmination of the whole journey

Respond with ONLY a valid JSON array of exactly 100 objects and nothing else:
[{"day":1,"title":"Short Title","action":"2-3 sentence action description.","focus":"theme"},...]
`;

  let anthropicRes;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 16000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
  } catch (networkErr) {
    return res.status(502).json({ error: 'Could not reach the AI service. Please try again.' });
  }

  if (!anthropicRes.ok) {
    const errBody = await anthropicRes.json().catch(() => ({}));
    const status = anthropicRes.status;
    if (status === 401) return res.status(500).json({ error: 'Server API key is invalid. Please contact the app owner.' });
    if (status === 429) return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    return res.status(status).json({ error: errBody.error?.message || `AI service error (${status}).` });
  }

  const data = await anthropicRes.json();
  const text = data.content?.[0]?.text || '';

  let days;
  try {
    days = JSON.parse(text);
  } catch {
    const match = text.match(/\[\s*\{[\s\S]*\}\s*\]/);
    if (!match) {
      return res.status(500).json({ error: 'Unexpected response format from AI. Please try again.' });
    }
    try {
      days = JSON.parse(match[0]);
    } catch {
      return res.status(500).json({ error: 'Could not parse the plan. Please try again.' });
    }
  }

  if (!Array.isArray(days) || days.length < 90) {
    return res.status(500).json({ error: 'Received an incomplete plan. Please try again.' });
  }

  return res.status(200).json({ days: days.slice(0, 100) });
}
