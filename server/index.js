#!/usr/bin/env node
// Zero-dependency stdio MCP server for sakurazaka46.com public APIs.
'use strict';
const ORIGIN = 'https://sakurazaka46.com';
const API = ORIGIN + '/s/s46/api/';
const MIN_GAP_MS = 1000;
const VERSION = '0.4.1';
const CATEGORIES = ['release', 'goods', 'event', 'media', 'ticket', 'audition'];

// ---------- upstream ----------
const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('node:crypto');
const rawStore = new AsyncLocalStorage(); // set per tools/call when arguments.raw === true
let chain = Promise.resolve(); let last = 0;
// Serialized, >=1s spaced request (all hosts share one queue). as: 'json' (default) | 'text' | 'jsonp'.
// opts.form: object -> POST application/x-www-form-urlencoded (used only for EC-CUBE list paging; read-only).
function politeFetch(url, as = 'json', opts = {}) {
  const run = async () => {
    const wait = last + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    try {
      const headers = { 'User-Agent': 'skz46-official-plugin/' + VERSION, Accept: 'application/json,text/html,*/*' };
      const init = opts.form ? { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(opts.form).toString() } : { headers };
      if (opts.jar) { // per-call isolated cookie jar (Map), manual redirects; used only by check_store_stock
        init.redirect = 'manual';
        if (opts.jar.size) init.headers = { ...init.headers, Cookie: [...opts.jar].map(([k, v]) => `${k}=${v}`).join('; ') };
      }
      const res = await fetch(url, init);
      if (opts.jar) for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) { const m = /^([^=;\s]+)=([^;]*)/.exec(c); if (m) opts.jar.set(m[1], m[2]); }
      const text = await res.text();
      const rec = rawStore.getStore();
      if (rec) rec.push({ url, method: init.method || 'GET', http_status: res.status, content_type: res.headers.get('content-type'),
        fetched_at: new Date().toISOString(), sha256: crypto.createHash('sha256').update(text, 'utf8').digest('hex'), body: text });
      if (as === 'response') return { status: res.status, location: res.headers.get('location'), text };
      if (res.status !== 200) throw new Error(`Upstream HTTP ${res.status} for ${url}`);
      if (as === 'text') return text;
      let body = text;
      if (as === 'jsonp') { const m = /^\s*[\w$.]+\s*\(([\s\S]*)\)\s*;?\s*$/.exec(text); if (!m) throw new Error(`Upstream JSONP wrapper not found for ${url}`); body = m[1]; }
      let data;
      try { data = JSON.parse(body); } // content-type is often text/html; parse anyway
      catch { throw new Error(`Upstream returned non-JSON for ${url} (first bytes: ${text.slice(0, 60).replace(/\s+/g, ' ')})`); }
      if (data && data.result === 'NG') throw new Error(`Upstream returned {"result":"NG"} for ${url}`);
      return data;
    } finally { last = Date.now(); }
  };
  const p = chain.then(run, run); chain = p.catch(() => {}); return p;
}

const { memberIdFrom } = require('./members.js');
// ---------- normalize ----------
const { cleanImageUrl } = require('./images.js');
const img = u => cleanImageUrl(abs(u)); // absolute + shared junk filter for image fields
const abs = u => (!u ? undefined : /^https?:\/\//.test(u) ? u : u.startsWith('//') ? 'https:' + u : ORIGIN + (u.startsWith('/') ? '' : '/') + u);
function jstIso(s) { // 'YYYY/MM/DD HH:MM:SS' (JST) -> ISO +09:00
  const m = /^(\d{4})\/(\d{2})\/(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(s || '').trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}+09:00` : (s || undefined);
}
const ymdIso = d => /^\d{8}$/.test(d || '') ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
// Empty values are returned as explicit null (not omitted) so callers can tell 'source empty' from 'not parsed'.
const isEmpty = v => v === undefined || v === null || v === ''; // list containers (items: []) stay arrays; optional lists use nonEmpty() -> null
const clean = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, isEmpty(v) ? null : v]));
const toInt = v => (v === undefined || v === null || v === '' ? undefined : Number(v));

// Category labels exactly as the official news list prints them (/s/s46/news/list, p.type), checked 2026-10-16.
const NEWS_CATEGORY_LABELS = { release: 'リリース', goods: 'グッズ', event: 'イベント', media: 'メディア', ticket: 'チケット',
  audition: 'オーディション', shakehands: 'ミート＆グリート', other: 'その他', fanclub: 'ファンクラブ' };

// ---------- tools ----------
function checkOffset(o) { if (o !== undefined && !(Number.isInteger(o) && o >= 0)) throw new Error('offset must be a non-negative integer'); }
const tools = {
  list_news: {
    description: 'List official news from sakurazaka46.com (max 200 per call, newest first). Use for latest announcements, releases, events, media appearances, tickets.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      dy: { type: 'string', pattern: '^\\d{4}(\\d{2}(\\d{2})?)?$', description: 'YYYY, YYYYMM or YYYYMMDD. Omit for all news.' },
      category: { type: 'string', enum: CATEGORIES },
      offset: { type: 'integer', minimum: 0, description: '0-based offset (upstream st). Page size 200.' },
      include_content: { type: 'boolean', default: true, description: 'Include the article HTML body as content (default true; set false for a lighter response).' } } },
    async run(a) {
      if (a.dy !== undefined && !/^\d{4}(\d{2}(\d{2})?)?$/.test(a.dy)) throw new Error('dy must be YYYY, YYYYMM or YYYYMMDD');
      if (a.category !== undefined && !CATEGORIES.includes(a.category)) throw new Error('category must be one of ' + CATEGORIES.join(', '));
      checkOffset(a.offset);
      const q = new URLSearchParams();
      if (a.dy) q.set('dy', a.dy); if (a.category) q.set('cd', a.category); if (a.offset) q.set('st', String(a.offset));
      const d = await politeFetch(API + 'json/news' + (q.toString() ? '?' + q : ''));
      const items = (d.news || []).map(n => clean({ kind: 'news', id: n.code, title: n.title, caption: n.caption, url: abs(n.link),
        published_at: jstIso(n.pubdate), pubdate: n.pubdate, category: n.category, category_label: NEWS_CATEGORY_LABELS[n.category],
        tags: Array.isArray(n.tags) ? n.tags.map(String) : n.tags, thumbnail: img(n.thumbnail),
        ...(a.include_content === false ? {} : { content: n.content }) }));
      return { total: toInt(d.count) ?? items.length, offset: a.offset || 0, items };
    } },
  list_blog_posts: {
    description: 'List member blog posts (ブログ/部落格; title/link/member/time only, NO body). Max 200 per call, newest first. Filter by member_id or member (name/kana/romaji/alias).',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      member_id: { type: 'string', pattern: '^\\d+$', description: 'Member id, e.g. "59" (same as /s/s46/artist/59).' },
      member: { type: 'string', description: 'Member name or alias instead of member_id, e.g. "石森璃花", "りか", "Rika Ishimori" (resolved like resolve_member; ambiguous names are an error).' },
      offset: { type: 'integer', minimum: 0, description: '0-based offset (upstream st). Page size 200.' } } },
    async run(a) {
      if (a.member_id !== undefined && !/^\d+$/.test(String(a.member_id))) throw new Error('member_id must be digits');
      if (a.member !== undefined && a.member_id === undefined) a = { ...a, member_id: memberIdFrom(a.member) };
      checkOffset(a.offset);
      const q = new URLSearchParams({ cd: 'blog' });
      if (a.member_id) q.set('member_id', String(a.member_id)); if (a.offset) q.set('st', String(a.offset));
      const d = await politeFetch(API + 'json/diary?' + q);
      const items = (d.blog || []).map(b => clean({ kind: 'blog', id: b.id, title: b.title, url: abs(b.link), published_at: jstIso(b.pubdate),
        member_id: b.member_id, member_name: b.creator, thumbnail: img(b.thumbnail) }));
      return { total: toInt(d.count) ?? items.length, offset: a.offset || 0, items };
    } },
  list_meet_greet_events: {
    description: 'List MEET&GREET / online meet events (individual talk etc.) as published on the official event page.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    async run() {
      const d = await politeFetch(API + 'list/shakehands_list');
      const items = (d.shakehands || []).map(e => clean({ code: e.code, date: ymdIso(e.date), title: e.title,
        category: e.catename || e.catecode, category_code: e.catecode, url: abs(e.link), image: img(e.image_src) }));
      return { total: items.length, items };
    } },
  list_greeting_cards: {
    description: 'List member greeting cards (image URLs: avatar, card, cheki). Optional member_id or member (name/alias) filter (client-side).',
    inputSchema: { type: 'object', additionalProperties: false, properties: { member_id: { type: 'string', pattern: '^\\d+$' },
      member: { type: 'string', description: 'Member name or alias instead of member_id.' } } },
    async run(a) {
      if (a.member !== undefined && a.member_id === undefined) a = { ...a, member_id: memberIdFrom(a.member) };
      const d = await politeFetch(API + 'list/greeting'); // never send ct: it empties the result
      let items = (d.greeting || []).map(g => clean({ member_id: g.id, name: g.name && g.name.kanji, name_kana: g.name && g.name.furi,
        avatar: img(g.arti_image), card: img(g.card), cheki: img(g.cheki) }));
      if (a.member_id !== undefined) items = items.filter(g => String(g.member_id) === String(a.member_id));
      return { total: items.length, items };
    } },
};

{ const { _parseSessions, ...htmlTools } = require('./html-tools.js')({ politeFetch, abs, jstIso, clean, ORIGIN }); Object.assign(tools, htmlTools); }
Object.assign(tools, require('./special-tools.js')({ politeFetch, clean, ORIGIN }));
Object.assign(tools, require('./store-tools.js')({ politeFetch, clean }));
tools.resolve_member = require('./members.js').resolve_member;
// Short 'Use for / Not for' descriptions (+ examples) for weak models; ask is listed first as the entry point.
const DESC = {
  list_news: 'Use for: official news (新聞/ニュース/公告) by month or category. Not for: blog posts or the TV/radio schedule. e.g. "10月有什麼新聞", "グッズのお知らせ".',
  list_blog_posts: 'Use for: latest member blog posts (ブログ/部落格) list, optionally one member (member name/alias ok). Not for: the blog text (use get_blog_post). e.g. "石森璃花 最新blog".',
  get_blog_post: 'Use for: full text + images of one blog post by id (from list_blog_posts). Not for: finding posts. e.g. "read blog 71404".',
  list_meet_greet_events: 'Use for: list of MEET&GREET / 見面會 / ミーグリ / 握手 events (codes). Not for: session times (then call get_meet_greet_event). e.g. "16單見面會有哪些".',
  get_meet_greet_event: 'Use for: one meet&greet page: dates, venues, 第N部 start/end/受付 times, members. Not for: discovering events. e.g. "京都 第3部幾點" after finding the code.',
  list_greeting_cards: 'Use for: member greeting card images (問候卡/グリーティングカード). Not for: profiles. e.g. "璃花的問候卡".',
  get_schedule: 'Use for: official schedule (行程/スケジュール): TV, radio, magazines, events, birthdays; filters date/month/label/member/genre:"music_tv" (音番). Not for: news articles. e.g. "今天的行程", "11月 音番".',
  get_formation: 'Use for: formation (站位/選拔/フォーメーション) of single N or album; center only if official evidence (infer_center opt-in). Not for: track lists. e.g. "16單站位".',
  list_discography: 'Use for: all releases (code, title, type, date). Not for: track lists (use get_discography). e.g. "出過哪些專輯".',
  get_discography: 'Use for: one release by code: tracks, editions, price (Sony Music data opt-in). Not for: formation. e.g. "SRCL-13890 曲目".',
  list_special_pages: 'Use for: discovering official special pages (live/tour/anniversary sites, 演唱會/ライブ). Not for: the schedule. e.g. "有哪些演唱會特設頁".',
  get_special_page: 'Use for: text/images/links/videos of one special page by slug. Not for: discovery. e.g. "backslive_16th 頁內容".',
  list_store_categories: 'Use for: official goods store (周邊/グッズ) category list. Not for: products. e.g. "商店有哪些分類".',
  list_store_products: 'Use for: searching/browsing store products (周邊/グッズ) by keyword/category/page. Not for: stock depth. e.g. "タオル 周邊".',
  get_store_product: 'Use for: one store product: price, variations, public in_stock/SOLD OUT. Not for: stock counts. e.g. "product 12345 有貨嗎".',
  check_store_stock: 'Use for: "is there at least N in stock" via a temporary guest cart on the live store (always emptied; no checkout). Not for: browsing; prefer get_store_product first. e.g. "還剩很多嗎".',
  resolve_member: 'Use for: member name/kana/romaji/nickname/zh spelling -> member_id, or "all". Not for: blog/schedule (those accept member names directly). e.g. "谷口爱季 是誰".',
};
for (const [k, d] of Object.entries(DESC)) if (tools[k]) tools[k].description = d;
{ const { ask } = require('./router.js')({ tools }); const rest = { ...tools }; for (const k of Object.keys(tools)) delete tools[k]; Object.assign(tools, { ask }, rest); }
// Follow-up hints: suggested next tool + params (first few items only).
function nextHints(name, args, out) {
  const it = (out && out.items) || [];
  const map = {
    list_blog_posts: () => it.slice(0, 3).map(p => ({ tool: 'get_blog_post', params: { id: String(p.id) }, why: 'read the post' })),
    list_meet_greet_events: () => it.slice(0, 3).map(e => ({ tool: 'get_meet_greet_event', params: { code: String(e.code) }, why: 'session times' })),
    list_discography: () => it.slice(0, 3).map(r => ({ tool: 'get_discography', params: { code: r.code }, why: 'tracks/editions' })),
    list_special_pages: () => it.slice(0, 3).map(s => ({ tool: 'get_special_page', params: { slug: s.slug }, why: 'page content' })),
    list_store_categories: () => it.slice(0, 3).map(c => ({ tool: 'list_store_products', params: { category_id: String(c.id) }, why: 'products' })),
    list_store_products: () => it.slice(0, 3).map(p => ({ tool: 'get_store_product', params: { product_id: String(p.product_id) }, why: 'price/variations/in_stock' })),
    get_store_product: () => out.product_id ? [{ tool: 'check_store_stock', params: { product_id: String(out.product_id) }, why: 'at-least-N stock (guest cart probe)' }] : [],
    resolve_member: () => it.length === 1 ? [{ tool: 'list_blog_posts', params: { member_id: it[0].member_id } }, { tool: 'get_schedule', params: { member: it[0].member_id } }] : [],
    get_formation: () => out.discography_codes ? out.discography_codes.slice(0, 1).map(c => ({ tool: 'get_discography', params: { code: c }, why: 'track list' })) : [],
  };
  const f = map[name]; if (!f) return null;
  const h = f().filter(x => Object.values(x.params).every(v => v != null && v !== 'undefined'));
  return h.length ? h : null;
}
function askNext(out) { const r = out.result; if (!r) return null; const i = out.interpreted_as.intent;
  const t = { blog: 'list_blog_posts', news: null, discography: 'list_discography', store: 'list_store_products', special: 'list_special_pages', member: 'resolve_member', formation: 'get_formation', center: 'get_formation' }[i];
  if (i === 'meet_greet' && r.events) return nextHints('list_meet_greet_events', {}, { items: r.events });
  if (i === 'store_stock' && r.products) return nextHints('list_store_products', {}, { items: r.products });
  if (i === 'store_stock' && r.product) return nextHints('get_store_product', {}, r.product);
  return t ? nextHints(t, {}, r) : null; }
// Every tool accepts raw:true -> the result also carries raw[]: one entry per upstream request
// {url, method, http_status, content_type, fetched_at (ISO UTC), sha256 (hex of the UTF-8 body), body (raw text)}.
for (const t of Object.values(tools)) t.inputSchema.properties = { ...t.inputSchema.properties,
  raw: { type: 'boolean', default: false, description: 'Also return raw upstream responses (url, http_status, fetched_at, sha256, body) for every request this call made.' } };

// ---------- JSON-RPC over stdio ----------
const send = m => process.stdout.write(JSON.stringify(m) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });
async function handle(msg) {
  const { id, method, params = {} } = msg; const isReq = id !== undefined && id !== null;
  try {
    switch (method) {
      case 'initialize':
        return reply(id, { protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} },
          serverInfo: { name: 'skz46-official', version: VERSION } });
      case 'notifications/initialized': case 'notifications/cancelled': return;
      case 'ping': return reply(id, {});
      case 'tools/list':
        return reply(id, { tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) });
      case 'tools/call': {
        const t = tools[params.name];
        if (!t) return fail(id, -32602, 'Unknown tool: ' + params.name);
        try {
          const { raw, ...args } = params.arguments || {};
          let out;
          if (raw === true) { const rec = []; out = await rawStore.run(rec, () => t.run(args)); out = { ...out, raw: rec }; }
          else out = await t.run(args);
          if (out && typeof out === 'object' && !Array.isArray(out) && !('next' in out)) out = { ...out, next: params.name === 'ask' ? askNext(out) : nextHints(params.name, args, out) };
          return reply(id, { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out, isError: false });
        } catch (e) { return reply(id, { content: [{ type: 'text', text: 'Error: ' + e.message }], isError: true }); }
      }
      default: if (isReq) return fail(id, -32601, 'Method not found: ' + method);
    }
  } catch (e) { if (isReq) fail(id, -32603, e.message); }
}
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { buf += c; let i;
  while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
    let m; try { m = JSON.parse(line); } catch { fail(null, -32700, 'Parse error'); continue; }
    (Array.isArray(m) ? m : [m]).forEach(track); } });
// Exit only after every in-flight request has replied (tools may chain several upstream calls).
let inflight = 0, ended = false;
function track(m) { inflight++; Promise.resolve(handle(m)).finally(() => { inflight--; if (ended && !inflight) process.exit(0); }); }
process.stdin.on('end', () => { ended = true; if (!inflight) process.exit(0); });
