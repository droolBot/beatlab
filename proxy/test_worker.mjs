// node proxy/test_worker.mjs -- the proxy's rules, with Groq stubbed out and the real Limit counter behind a fake Durable Object namespace
import worker, { Limit } from './worker.js';

const assert = (c, msg) => { if (!c) throw new Error(msg); };
const sent = [], counters = new Map();
let groq = () => new Response('{"choices":[{"message":{"content":"{}"}}]}');
globalThis.fetch = async (u, o) => { sent.push({ u, o }); return groq(); };
const env = { GROQ_KEY: 'test-only', LIMIT: { idFromName: ip => ip, get: ip => counters.get(ip) ?? counters.set(ip, new Limit()).get(ip) } };
const call = (method, path, origin, body, ip = '198.51.100.1') => worker.fetch(new Request(`https://beatlab-ai.test.workers.dev${path}`, { method, body, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...(origin && { Origin: origin }) } }), env);
const ask = JSON.stringify({ model: 'some-big-model', messages: [{ role: 'user', content: 'hi' }], max_tokens: 99999, temperature: 0.5, response_format: { type: 'json_object' }, tools: [{ type: 'browser_search' }], n: 8 });
const site = 'https://droolbot.github.io', desk = 'http://127.0.0.1:8765';

let r = await call('OPTIONS', '/chat/completions', site);
assert(r.status === 204 && r.headers.get('Access-Control-Allow-Origin') === site && /Content-Type/.test(r.headers.get('Access-Control-Allow-Headers')), 'the browser may ask from the website');
r = await call('POST', '/chat/completions', 'https://another.site', ask);
assert(r.status === 403 && !r.headers.get('Access-Control-Allow-Origin'), 'another website is turned away');
r = await call('POST', '/chat/completions', null, ask);
assert(r.status === 403, 'a request with no Origin is turned away');
r = await call('GET', '/models', 'http://localhost:8765');
assert(r.status === 404, 'only POST /chat/completions');
r = await call('POST', '/chat/completions', desk, '{not json');
assert(r.status === 400, 'bad JSON');
assert(!sent.length, 'nothing reached Groq yet');

r = await call('POST', '/chat/completions', desk, ask);
const out = JSON.parse(sent[0].o.body);
assert(r.status === 200 && r.headers.get('Access-Control-Allow-Origin') === desk && (await r.json()).choices, "Groq's answer reaches the desktop app");
assert(sent[0].u === 'https://api.groq.com/openai/v1/chat/completions' && sent[0].o.headers.Authorization === 'Bearer test-only', 'it goes to Groq with the secret key');
assert(out.model === 'openai/gpt-oss-120b' && out.reasoning_effort === 'low' && out.max_tokens === 2500, `model, thinking and length are fixed: ${sent[0].o.body}`);
assert(out.messages[0].content === 'hi' && out.temperature === 0.5 && out.response_format.type === 'json_object' && !('tools' in out) && !('n' in out), `only the studio's fields go on: ${sent[0].o.body}`);

groq = () => new Response('{"error":{"message":"Rate limit reached for model in organization org_0123"}}', { status: 429 });
r = await call('POST', '/chat/completions', site, ask);
const text = await r.text();
assert(r.status === 429 && r.headers.get('Access-Control-Allow-Origin') === site && !text.includes('org_'), `Groq's 429 passes through, readable by the page, without the account: ${text}`);

groq = () => new Response('{"choices":[]}');
const before = sent.length, codes = [];
for (let i = 0; i < 7; i++) codes.push((await call('POST', '/chat/completions', site, ask, '203.0.113.9')).status);
assert(codes.join() === '200,200,200,200,200,429,429' && sent.length === before + 5, `5 a minute per visitor, and the rest stop before Groq: ${codes}`);
r = await call('POST', '/chat/completions', site, ask, '203.0.113.10');
assert(r.status === 200, 'another visitor still gets through');
r = await call('POST', '/chat/completions', site, ask, '203.0.113.9');
assert(r.status === 429 && r.headers.get('Access-Control-Allow-Origin') === site, 'the 429 is readable by the page');
console.log('proxy ok: origins, path, fixed model and length, 429s, 5 a minute per visitor');
