// Test-only preload (node -r ./test/mock-fetch.cjs server/index.js): replaces global fetch, no network.
// MOCK_FETCH=empty : schedule months have no events, LIVE/ARCHIVE lists are empty, news returns MOCK_NEWS_N items of ~10 KB.
// MOCK_FETCH=hang  : every request hangs until its AbortSignal fires.
// MOCK_FETCH=flaky : the first request to each URL hangs, later ones answer like 'empty'.
// MOCK_LOG=<file>  : appends "<epoch ms> <url>" per request (to verify the >=1 s spacing).
'use strict';
const fs = require('node:fs');
const mode = process.env.MOCK_FETCH || 'empty';
const N = Number(process.env.MOCK_NEWS_N || 200);
globalThis.fetch = async (url, init = {}) => {
  if (process.env.MOCK_LOG) fs.appendFileSync(process.env.MOCK_LOG, `${Date.now()} ${url}\n`);
  const signal = init.signal;
  const abortable = p => new Promise((res, rej) => {
    if (signal) { if (signal.aborted) return rej(signal.reason); signal.addEventListener('abort', () => rej(signal.reason), { once: true }); }
    p.then(res, rej); });
  if (mode === 'hang') return abortable(new Promise(() => {}));
  if (mode === 'flaky') { globalThis.__seen = globalThis.__seen || new Set(); if (!globalThis.__seen.has(String(url))) { globalThis.__seen.add(String(url)); return abortable(new Promise(() => {})); } }
  const html = b => new Response(b, { status: 200, headers: { 'content-type': 'text/html; charset=UTF-8' } });
  const u = String(url);
  if (/\/media\/list/.test(u)) return html('<html><script>var scheduleEvents = [\n];</script></html>');
  if (/live_page\/list|archive\/list/.test(u)) return html('<html><main><ul></ul></main></html>');
  if (/api\/json\/news/.test(u)) {
    const st = Number(new URL(u).searchParams.get('st') || 0);
    const news = []; for (let i = st; i < Math.min(N, st + 200); i++) news.push({ category: 'event', code: String(70000 + i), title: `News ${i}`, caption: `cap ${i}`,
      link: `/s/s46/news/detail/${70000 + i}`, pubdate: '2026/10/15 12:00:00', thumbnail: '', content: `<p>${'本文テキスト'.repeat(560)}</p>`, tags: i % 3 ? ['59'] : undefined });
    return html(JSON.stringify({ count: String(N), news }));
  }
  return new Response('not found', { status: 404 });
};
