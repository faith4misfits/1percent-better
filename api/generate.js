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
  // ── CORS headers (allow the frontend to call this) ──
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── Validate input ──
  const { goal, quiz = {} } = req.body || {};
  if (!goal || typeof goal !== 'string' || goal.trim().length < 3) {
    return res.status(400).json({ error: 'A valid goal is required.' });
  }

  // ── Check API key is configured ──
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'The server is not configured yet. Please contact the app owner.',
    });
  }

  // ── Translate quiz answers into human-readable context ──
  const startingPointMap = {
    beginner:  'a complete beginner who is starting from scratch',
    some:      'someone with some prior experience who has tried this before but never fully committed',
    practiced: 'a practiced person with an existing foundation who wants to go deeper',
  };
  const timeMap = {
    '5min':   '5\u201310 minutes per day (micro-habits, tiny wins only)',
    '20min':  '15\u201320 minutes per day (a focused daily window)',
    '45min':  '30\u201345 minutes per day (serious daily commitment)',
    '60min+': '1 hour or more per day (full transformation mode)',
  };
  const styleMap = {
    solo:      'solo and reflective (journaling, quiet thinking, private practice)',
    active:    'active and hands-on (building, experimenting, learning by doing)',
    community: 'community-oriented (accountability partners, sharing progress, connecting with others)',
  };

  const startingCtx  = startingPointMap[quiz.startingPoint]  || 'someone at any level';
  const timeCtx      = timeMap[quiz.timeCommitment]          || 'a flexible amount of time';
  const styleCtx     = styleMap[quiz.learningStyle]          || 'their own preferred style';

  // ── Build the personalised prompt ──
  const prompt = `You are a world-class personal development coach. The user's 100-day goal is:

"${goal.trim()}"

User profile (use this to personalize every single day of the plan):
- Starting point: ${startingCtx}
- Daily time available: ${timeCtx}
- Growth style: ${styleCtx}

Design a transformative 100-day journey where each day is one tiny 1% improvement compounding toward the goal. Use this arc:
- Days 1\u201310: Tiny first steps calibrated to their starting point (never exceed their daily time limit)
- Days 11\u201325: Building micro-habits and foundations that match their learning style
- Days 26\u201350: Deepening engagement and growing consistency
- Days 51\u201375: Expanding, stretching, and refining the practice
- Days 76\u201390: Sustained mastery and integration
- Days 91\u2013100: Reflection, celebration, and identity solidification

Rules:
- Every action must be SPECIFIC to THIS goal AND personalized to this user's profile
- Daily actions must NEVER require more time than stated \u2014 be realistic
- Reflect their growth style: ${styleCtx === styleMap.solo ? 'favor journaling, reflection prompts, and private practices' : styleCtx === styleMap.active ? 'favor doing, building, experimenting, and measurable action steps' : 'weave in accountability check-ins, sharing moments, and community touchpoints'}
- Each day must feel meaningfully different from the previous days
- Vary the "focus" theme across: mindset, habit, learning, practice, community, reflection, challenge, creativity, rest, milestone
- Write action descriptions in warm second-person ("Today, try\u2026" or "Take a moment to\u2026")
- Day 100 should be a meaningful culmination and celebration of the whole journey

Respond with ONLY a valid JSON array of exactly 100 objects and nothing else:
[{"day":1,"title":"Short Title","action":"2\u20133 sentence action description.","focus":"theme"},...]`;

  // ── Call Anthropic ──
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

  // ── Parse the response ──
  const data = await anthropicRes.json();
  const text = data.content?.[0]?.text || '';

  let days;
  try {
    days = JSON.parse(text);
  } catch {
    // Try extracting a JSON array if the model wrapped it in text
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
