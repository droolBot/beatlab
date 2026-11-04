// BeatLab AI: the studio's chat sends its request here, and this passes it on to Groq with the owner's key, so
// visitors don't need a key of their own. The key is a Cloudflare secret (see wrangler.toml), never in a file.
// Nothing here logs what people send.
const ORIGINS = ['https://droolbot.github.io', 'http://localhost:8765', 'http://127.0.0.1:8765'];  // the website, and the desktop app (python beatlab.py opens 127.0.0.1)

// 5 chat messages a minute per visitor IP, counted exactly in one small Durable Object per IP. (Cloudflare's rate-limit
// binding counts per machine: it let 70 quick requests from one IP through.)
// ponytail: the times live in memory, so an IP that goes quiet long enough for Cloudflare to unload its counter starts fresh
export class Limit {
  times = [];
  async fetch() {
    const now = Date.now();
    this.times = this.times.filter(t => now - t < 60_000);
    if (this.times.length >= 5) return new Response(null, { status: 429 });
    this.times.push(now);
    return new Response(null, { status: 204 });
  }
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin');
    if (!ORIGINS.includes(origin)) return new Response('Only BeatLab can use this.', { status: 403 });
    const cors = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } });
    const reply = (status, body = JSON.stringify({ error: { message: `error ${status}` } })) => new Response(body, { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method !== 'POST' || new URL(req.url).pathname !== '/chat/completions') return reply(404);
    // ponytail: per minute, so someone determined can still spend the day's Groq quota; count per day in Limit if that happens
    const counter = env.LIMIT.get(env.LIMIT.idFromName(req.headers.get('CF-Connecting-IP') ?? 'unknown'));
    if ((await counter.fetch('https://limit/')).status === 429) return reply(429);
    let ask;
    try { ask = (await req.json()) ?? {}; } catch { return reply(400); }
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GROQ_KEY}`, 'Content-Type': 'application/json' },
      // only what the studio uses goes on; the model, how long it thinks and the reply length are set here, whatever the page asks for
      body: JSON.stringify({ messages: ask.messages, temperature: ask.temperature, response_format: ask.response_format, model: 'openai/gpt-oss-120b', reasoning_effort: 'low', max_tokens: Math.min(Number(ask.max_tokens) || 2500, 2500) }),
    });
    // a 429 stays a 429, so the studio says the free limit is used up; Groq's error text names the owner's account, so it stays here
    return reply(r.status, r.ok ? r.body : undefined);
  },
};
