// Usage: BASE=http://127.0.0.1:3102 TOKEN=<jwt> node backend/test/realtime-smoke.mjs
// Opens the SSE stream and prints every event with a timestamp. Starts nothing itself.
const BASE = process.env.BASE || 'http://127.0.0.1:3001';
const TOKEN = process.env.TOKEN;
if (!TOKEN) { console.error('TOKEN env required'); process.exit(1); }
const res = await fetch(`${BASE}/api/events/stream?token=${encodeURIComponent(TOKEN)}`, { headers: { Accept: 'text/event-stream' } });
console.log('status', res.status, res.headers.get('content-type'));
if (!res.ok) { console.error(await res.text()); process.exit(1); }
const dec = new TextDecoder();
let buf = '';
for await (const chunk of res.body) {
  buf += dec.decode(chunk, { stream: true });
  let i;
  while ((i = buf.indexOf('\n\n')) >= 0) {
    console.log(new Date().toISOString(), buf.slice(0, i).replace(/\n/g, ' | '));
    buf = buf.slice(i + 2);
  }
}
