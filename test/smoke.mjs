// Spawns the server over stdio and exercises every tool with real upstream calls.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url'; import path from 'node:path'; import fs from 'node:fs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Usage: node test/smoke.mjs [command args...]   (default: node server/index.js)
const cmdArgs = process.argv.slice(2);
const [cmd, ...args] = cmdArgs.length ? cmdArgs : ['node', [path.join(root, 'server/index.js')]].flat();
console.log('server command:', [cmd, ...args].join(' '));
const srv = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '', nid = 0; const pend = new Map();
srv.stdout.on('data', c => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); pend.get(m.id)?.(m); pend.delete(m.id); } });
const rpc = (method, params) => new Promise(r => { const id = ++nid; pend.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
const call = async (name, args) => { const m = await rpc('tools/call', { name, arguments: args }); assert.equal(m.result.isError, false, JSON.stringify(m.result.content)); return m.result.structuredContent; };
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/, URLRE = /^https:\/\//;
const samples = {}; const results = []; const ok = n => { results.push('PASS ' + n); console.log('PASS', n); };
const trim = o => ({ ...o, items: o.items.slice(0, 2) });
try {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
  assert.equal(init.result.serverInfo.name, 'skz46-official'); ok('initialize');
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  assert.deepEqual((await rpc('ping', {})).result, {}); ok('ping');
  const tl = await rpc('tools/list', {});
  assert.deepEqual(tl.result.tools.map(t => t.name).sort(), ['get_blog_post', 'get_discography', 'get_formation', 'get_schedule', 'list_blog_posts', 'list_discography', 'list_greeting_cards', 'list_meet_greet_events', 'list_news'].concat('get_meet_greet_event', 'list_special_pages', 'get_special_page', 'list_store_categories', 'list_store_products', 'get_store_product', 'resolve_member', 'check_store_stock', 'ask').sort()); assert.equal(tl.result.tools[0].name, 'ask'); assert.ok(tl.result.tools.every(t => /Use for:|START HERE/.test(t.description) && t.description.length < 420)); ok('tools/list (18 tools, ask first, short Use for/Not for descriptions)');

  const n = await call('list_news', { dy: '202610', category: 'release' });
  assert.ok(n.total > 0 && n.items.length === Math.min(n.total, 200));
  for (const it of n.items) { assert.equal(it.kind, 'news'); assert.equal(it.category, 'release'); assert.match(it.published_at, ISO); assert.match(it.url, URLRE); assert.ok(it.id && it.title); assert.ok('content' in it && 'tags' in it && 'caption' in it && 'thumbnail' in it); assert.match(it.pubdate, /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/); assert.equal(it.category_label, 'リリース'); if (it.thumbnail) assert.match(it.thumbnail, URLRE); assert.ok(it.published_at.startsWith('2026-10')); }
  samples.list_news = trim(n); ok(`list_news dy=202610 category=release (total ${n.total})`);
  const nc = await call('list_news', { dy: '20261015', include_content: false });
  assert.ok(nc.items.every(i => !('content' in i) && i.published_at.startsWith('2026-10-15'))); ok(`list_news dy=20261015 include_content=false (total ${nc.total})`);
  const nt = await call('list_news', { dy: '202610' }); const tagged = nt.items.filter(i => Array.isArray(i.tags));
  assert.ok(tagged.length > 0 && tagged.every(i => i.tags.every(t => /^\d+$/.test(t)))); assert.ok(nt.items.some(i => i.tags === null), 'untagged items carry tags:null');
  assert.ok(nt.items.every(i => typeof i.content === 'string')); ok(`list_news hub fields: tags on ${tagged.length}/${nt.items.length}, caption/category_label/content/pubdate present`);

  const b = await call('list_blog_posts', { member_id: '59' });
  assert.ok(b.total > 0); for (const it of b.items) { assert.equal(it.kind, 'blog'); assert.equal(it.member_id, '59'); assert.ok(it.member_name); assert.match(it.published_at, ISO); assert.match(it.url, URLRE); }
  samples.list_blog_posts = trim(b); ok(`list_blog_posts member_id=59 (total ${b.total}, got ${b.items.length})`);
  const b0 = await call('list_blog_posts', {}); const b200 = await call('list_blog_posts', { offset: 200 });
  assert.equal(b0.items.length, 200); assert.ok(b200.items.length > 0);
  const ids0 = new Set(b0.items.map(i => i.id)); assert.ok(b200.items.every(i => !ids0.has(i.id)), 'page 2 overlaps page 1');
  assert.ok(b200.items[0].published_at <= b0.items[199].published_at); ok(`list_blog_posts offset=200 is a disjoint older page (total ${b0.total})`);

  const e = await call('list_meet_greet_events', {});
  assert.ok(e.total > 0); for (const it of e.items) { assert.ok(it.code && it.title); assert.match(it.date, /^\d{4}-\d{2}-\d{2}$/); assert.match(it.url, URLRE); }
  samples.list_meet_greet_events = trim(e); ok(`list_meet_greet_events (total ${e.total})`);

  const g = await call('list_greeting_cards', { member_id: '59' });
  assert.equal(g.total, 1); const c = g.items[0]; assert.equal(c.member_id, '59'); assert.ok(c.name && c.name_kana); for (const k of ['avatar', 'card', 'cheki']) if (c[k]) assert.match(c[k], URLRE);
  samples.list_greeting_cards = g; ok('list_greeting_cards member_id=59');
  const ga = await call('list_greeting_cards', {}); assert.ok(ga.total >= 20); ok(`list_greeting_cards all (total ${ga.total})`);


  // ---- v0.2.0 HTML tools ----
  const jstNow = new Date(Date.now() + 9 * 3600e3); const thisMonth = jstNow.toISOString().slice(0, 7);
  const isMember = m => { assert.ok(m.name); if (m.member_id != null) assert.match(m.member_id, /^\d+$/); };
  const sm = await call('get_schedule', {});
  assert.equal(sm.month, thisMonth); assert.ok(sm.total > 0);
  for (const it of sm.items) { assert.ok(it.date.startsWith(thisMonth) && it.title && it.category); assert.match(it.url, URLRE);
    if (it.start_time) assert.match(it.start_time, /^\d{1,2}:\d{2}$/); (it.members || []).forEach(isMember); (it.links || []).forEach(l => assert.match(l, /^https?:\/\//)); }
  assert.ok(sm.items.some(i => i.members && i.members.length), 'no members parsed'); assert.ok(sm.items.some(i => i.start_time), 'no times parsed');
  samples.get_schedule = trim(sm); ok(`get_schedule current month ${thisMonth} (total ${sm.total})`);
  const sd = await call('get_schedule', { date: '2026-10-18' });
  assert.ok(sd.total > 0 && sd.items.every(i => i.date === '2026-10-18')); ok(`get_schedule date=2026-10-18 (total ${sd.total})`);
  const sc = await call('get_schedule', { month: '2026-11', category: 'shakehands' });
  assert.ok(sc.items.every(i => i.category === 'shakehands' && i.date.startsWith('2026-11'))); ok(`get_schedule month=2026-11 category=shakehands (total ${sc.total})`);

  const checkRows = rows => { assert.ok(rows && (rows.front || rows.second || rows.third)); for (const r of Object.values(rows)) r.forEach(m => { if (m.member_id != null) assert.match(m.member_id, /^\d+$/); assert.ok(m.name); }); };
  const fl = await call('get_formation', {});
  assert.equal(fl.kind, 'single'); assert.ok(fl.single_number >= 16 && fl.title); assert.match(fl.release_date, /^\d{4}-\d{2}-\d{2}$/); checkRows(fl.rows); assert.ok(fl.rows.front.length > 0);
  if (fl.single_number === 16) { assert.equal(fl.discography_code, 'SRCL-13890'); assert.ok(fl.discography_codes.includes('SRCL-13898'));
    assert.ok(fl.discography_codes.every(c => /^SRCL-138\d\d$/.test(c) && !/^SRCL-1375\d$/.test(c)), 'single 16 resolved to wrong family'); assert.ok(fl.note); }
  samples.get_formation = { ...fl, songs: undefined }; ok(`get_formation latest (single ${fl.single_number} 「${fl.title}」)`);
  const f15 = await call('get_formation', { single: 15 });
  assert.equal(f15.single_number, 15); assert.deepEqual(f15.discography_codes, ['SRCL-13750', 'SRCL-13752', 'SRCL-13754', 'SRCL-13756', 'SRCL-13758', 'SRCL-13759']); assert.equal(f15.note, null); assert.ok(f15.songs.length >= 2); f15.songs.forEach(s => { assert.ok(s.title); checkRows(s.rows); }); ok(`get_formation single=15 (${f15.songs.length} songs)`);
  const fall = await call('get_formation', { list: true });
  assert.ok(fall.total >= 18 && fall.items.some(i => i.kind === 'album')); assert.ok(fall.items.every(i => i.discography_code), JSON.stringify(fall.items.filter(i => !i.discography_code))); ok(`get_formation list (total ${fall.total})`);
  // center
  assert.deepEqual(fl.songs[0].center, { member_id: '63', name: '谷口愛季' }); assert.equal(fl.songs[0].center_source, 'official'); assert.equal(fl.songs[0].center_confidence, 'high'); assert.match(fl.songs[0].center_evidence.url, URLRE);
  ok('get_formation single 16 center 谷口愛季 (official, high)');
  const f12d = await call('get_formation', { single: 12 });
  assert.equal(f12d.songs[0].center, null); assert.equal(f12d.songs[0].center_source, null); ok('get_formation single 12: no center by default (inference off)');
  const f12 = await call('get_formation', { single: 12, infer_center: true });
  assert.equal(f12.songs[0].center.name, '的野美青'); assert.equal(f12.songs[0].center_source, 'front_row_middle'); assert.equal(f12.songs[0].center_confidence, 'medium'); assert.ok(f12.songs[0].center_evidence == null);
  ok('get_formation single 12 center 的野美青 (front_row_middle, medium)');
  const f4 = await call('get_formation', { single: 4 });
  const even = f4.songs.find(s => s.title === '制服の人魚'); assert.equal(even.rows.front.length, 4); assert.equal(even.center, null); ok('4-in-front song (制服の人魚) has no center');
  const jil = f4.songs.find(s => s.title === '僕のジレンマ'); assert.ok(jil.rows.front.length && jil.rows.second.length && jil.rows.third.length); assert.equal(jil.center.name, '渡邉理佐');
  const f10 = await call('get_formation', { single: 10 }); const arashi = f10.songs.find(s => s.title === '嵐の前、世界の終わり'); assert.ok(arashi && Object.values(arashi.rows).flat().length > 0);
  const f5 = await call('get_formation', { single: 5 }); const natsu = f5.songs.find(s => s.title === '夏の近道'); assert.ok(natsu && Object.values(natsu.rows).flat().length > 0);
  const a2 = await call('get_formation', { album: 2 }); const addi = a2.songs.find(s => s.title === 'Addiction'); assert.ok(addi && Object.values(addi.rows).flat().length > 0, 'Addiction rows empty');
  ok('previously empty songs (僕のジレンマ, 嵐の前、世界の終わり, 夏の近道, Addiction) now have rows');
  const fbad = await rpc('tools/call', { name: 'get_formation', arguments: { single: 999 } }); assert.equal(fbad.result.isError, true); ok('get_formation single=999 -> isError');

  const bp = await call('get_blog_post', { id: '71404' });
  assert.equal(bp.id, '71404'); assert.equal(bp.member_id, '48'); assert.ok(bp.title && bp.member_name); assert.match(bp.published_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/);
  assert.ok(bp.body_text.length > 100 && bp.body_text.includes('\n') && !/<[a-z]/i.test(bp.body_text)); assert.ok(bp.images.length > 0); bp.images.forEach(u => assert.match(u, URLRE));
  samples.get_blog_post = { ...bp, body_text: bp.body_text.slice(0, 200) + '…' }; ok(`get_blog_post 71404 (${bp.body_text.length} chars, ${bp.images.length} images)`);

  const dl = await call('list_discography', {});
  assert.ok(dl.total > 50); for (const it of dl.items) { assert.match(it.code, /^[A-Z]+-\d+$/); assert.ok(it.title && it.type); assert.match(it.url, URLRE); if (it.jacket) assert.match(it.jacket, URLRE); }
  assert.ok(dl.items.some(i => i.code === 'SRCL-13890')); samples.list_discography = trim(dl); ok(`list_discography (total ${dl.total})`);
  const d0 = await call('get_discography', { code: 'SRCL-13890' }); assert.equal(d0.sonymusic, null); ok('get_discography: Sony Music off by default (sonymusic:null)');
  const dd = await call('get_discography', { code: 'SRCL-13890', include_sonymusic: true });
  assert.equal(dd.code, 'SRCL-13890'); assert.ok(dd.title && dd.release_date && dd.other_editions.length);
  assert.ok(dd.sonymusic, dd.sonymusic_error); assert.ok(dd.sonymusic.discs.length >= 1); dd.sonymusic.discs.forEach(d => assert.ok(d.tracks.length));
  assert.equal(typeof dd.sonymusic.price, 'number'); samples.get_discography = { ...dd, other_editions: dd.other_editions.slice(0, 1) }; ok(`get_discography SRCL-13890 (${dd.sonymusic.discs.length} discs, ${dd.sonymusic.discs.reduce((n, d) => n + d.tracks.length, 0)} tracks)`);

  // ---- meet&greet detail ----
  const ev = await call('list_meet_greet_events', {});
  const kyoto = ev.items.find(e => /16th/.test(e.title) && /リアル/.test(e.title) && e.date === '2026-12-20');
  assert.ok(kyoto, '16th real meet&greet on 2026-12-20 not in list');
  const mg = await call('get_meet_greet_event', { code: kyoto.code });
  assert.ok(mg.title && mg.body_text.length > 200); assert.match(mg.url, URLRE);
  const p3 = mg.sessions.find(x => x.city === '京都' && x.part === 3);
  assert.deepEqual([p3.date, p3.venue, p3.start_time, p3.end_time], ['2026-12-20', '京都パルスプラザ', '15:30', '16:30']);
  samples.answer_kyoto_part3 = { question: '16th single Kyoto meet&greet: what time is part 3?', code: kyoto.code, url: mg.url, session: p3 };
  ok(`get_meet_greet_event ${kyoto.code}: Kyoto part 3 = ${p3.date} ${p3.start_time}-${p3.end_time} @ ${p3.venue}`);
  const on = await call('get_meet_greet_event', { code: '71283' });
  const on3 = on.sessions.filter(x => x.part === 3); assert.equal(on3.length, 6);
  assert.deepEqual([on3[0].reception_start, on3[0].start_time, on3[0].reception_end, on3[0].end_time], ['14:15', '14:30', '15:15', '15:30']); ok('get_meet_greet_event 71283 online: 6 dates x part 3 with reception times');
  const m13 = await call('get_meet_greet_event', { code: '66667' });
  assert.ok(m13.members.includes('山﨑天') && !m13.members.some(x => /部/.test(x))); assert.ok(m13.sessions.find(x => x.date === '2026-01-10' && x.part === 3 && x.reception_start === '14:45' && x.end_time === '16:00')); ok(`get_meet_greet_event 66667: multi-section page, ${m13.members.length} lane members`);
  const sh = (await call('get_schedule', { date: '2026-10-18', category: 'shakehands' })).items[0];
  assert.ok(sh.sessions && sh.sessions.find(x => x.part === 3 && x.start_time === '14:30')); ok('get_schedule shakehands description -> sessions[]');
  const { createRequire } = await import('node:module'); const req = createRequire(import.meta.url);
  const P = req(path.join(root, 'server/html-tools.js'))({ politeFetch: async () => '', abs: x => x, jstIso: x => x, clean: o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')), ORIGIN: '' })._parseSessions;
  const r = P('■大阪会場\n開催日：２０２７年１月２日(土)\n会場：インテックス大阪\n＜第１０部＞　受付開始　２４：４５　／　イベント開始　２５：００　（２６：００ 終了予定）\n第2部（13:30～14:30）');
  assert.deepEqual(r.map(x => [x.part, x.start_time, x.end_time, x.reception_start || null, x.date, x.city]), [[2, '13:30', '14:30', null, '2027-01-02', '大阪'], [10, '25:00', '26:00', '24:45', '2027-01-02', '大阪']]);
  ok('session parser: full-width digits/colons, times past 24:00');

  // ---- special pages + image filter ----
  const I = req(path.join(root, 'server/images.js'));
  const noJunk = (urls, where) => { for (const u of urls) { assert.equal(I.rejectReason(u), undefined, `${where}: junk image ${u}`); assert.ok(!/[?&]ima=/.test(u), `${where}: ima param left in ${u}`); } assert.equal(new Set(urls).size, urls.length, `${where}: duplicate images`); };
  const sp = await call('list_special_pages', {});
  assert.ok(sp.total > 50 && sp.live_count > 20); assert.equal(new Set(sp.items.map(x => x.slug)).size, sp.items.length);
  for (const it of sp.items) { assert.match(it.slug, /^[A-Za-z0-9_-]+$/); assert.ok(['live', 'archive'].includes(it.source)); assert.match(it.url, URLRE); if (it.date) assert.match(it.date, /^\d{4}-\d{2}-\d{2}$/); }
  const b16 = sp.items.find(x => x.slug === 'backslive_16th'); assert.equal(b16.source, 'live'); assert.equal(b16.date, '2026-12-15'); assert.ok(!b16.thumbnail || !/logo/.test(b16.thumbnail), 'site logo used as live-list thumbnail must be dropped (archive thumbnail may fill in)');
  assert.ok(sp.items.some(x => x.source === 'archive' && x.thumbnail)); noJunk(sp.items.map(x => x.thumbnail).filter(Boolean), 'list_special_pages');
  samples.list_special_pages = trim(sp); ok(`list_special_pages (total ${sp.total}, live ${sp.live_count}, archive pages ${sp.archive_pages})`);
  const pb = await call('get_special_page', { slug: 'backslive_16th' });
  assert.ok(/BACKS LIVE/.test(pb.title) && /TICKET/.test(pb.text) && !/LOG IN|JASRAC/.test(pb.text)); assert.equal(pb.images.length, 2); noJunk(pb.images, 'backslive_16th');
  ok('get_special_page backslive_16th: hero KV kept (inside <header>), icons/logos dropped');
  const p16 = await call('get_special_page', { slug: '16th_single' });
  noJunk(p16.images, '16th_single'); assert.ok(p16.images.some(u => u.includes('/images/14/82b/')), 'lazy data-src image kept');
  assert.ok(p16.videos.some(v => v.provider === 'youtube' && v.id === '88-asxwFoI4') && p16.videos.some(v => v.provider === 'brightcove' && v.id));
  assert.ok(p16.links.some(l => l.external) && p16.links.some(l => !l.external)); for (const l of p16.links) assert.match(l.url, /^https?:\/\//);
  assert.ok(p16.text.length <= 20000 && /# /.test(p16.text)); samples.get_special_page = { ...p16, text: p16.text.slice(0, 400), images: p16.images.slice(0, 3), links: p16.links.slice(0, 3) };
  ok(`get_special_page 16th_single (${p16.images.length} images, ${p16.videos.length} videos, ${p16.links.length} links)`);
  const badSlug = await rpc('tools/call', { name: 'get_special_page', arguments: { slug: '../etc' } }); assert.equal(badSlug.result.isError, true); ok('get_special_page bad slug -> isError');
  noJunk(bp.images, 'get_blog_post 71404'); assert.equal(bp.images.length, 5); ok('get_blog_post images pass the shared filter (5/5 kept)');
  // offline unit checks for the filter and the text cap
  const html = `<img src="data:image/gif;base64,R0lG"><img src="https://www.facebook.com/tr?id=1&ev=PageView" width="1" height="1">
    <img class="lazyload" src="/files/14/s46/img/loading.gif" data-src="/images/14/abc/real.jpg"><img srcset="/images/14/a/s.jpg 320w, /images/14/a/l.jpg 1280w" src="/images/14/a/s.jpg">
    <img src="/files/14/s46/img/com-logo_pc.svg"><img src="/files/14/sakura/pages/x/images/icon_x.png"><img src="/images/14/abc/real.jpg?ima=0000">
    <div style="background-image:url('/files/14/sakura/pages/x/images/photo01.jpg')"></div><img src="https://img.youtube.com/vi/88-asxwFoI4/maxresdefault.jpg"><img src="https://www.sonymusic.co.jp/img/common/artist_image/jacket.jpg">`;
  const st = {}; const kept = I.extractImages(html, { backgrounds: true, stats: st });
  assert.deepEqual(kept, ['https://sakurazaka46.com/images/14/abc/real.jpg', 'https://sakurazaka46.com/images/14/a/l.jpg', 'https://sakurazaka46.com/files/14/sakura/pages/x/images/photo01.jpg', 'https://www.sonymusic.co.jp/img/common/artist_image/jacket.jpg']);
  assert.equal(st.dropped['data-uri'], 1); assert.equal(st.dropped['tracking-pixel'], 1); assert.equal(st.dropped.duplicate, 1);
  ok('image filter unit: data:, 1x1 pixel, lazy placeholder, srcset largest, chrome, icons, third-party, dedupe, sonymusic kept');
  const SP = req(path.join(root, 'server/special-tools.js'))({ politeFetch: async () => `<html><head><title>T</title></head><body><header><nav>menu</nav></header><main><h2>Big</h2><p>${'あ'.repeat(30000)}</p></main><footer>foot</footer></body></html>`, clean: o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)), ORIGIN: 'https://sakurazaka46.com' });
  const big = await SP.get_special_page.run({ slug: 'x' }); assert.equal(big.truncated, true); assert.equal(big.text.length, 20000); assert.ok(!/menu|foot/.test(big.text)); ok('get_special_page text cap 20k + truncated flag; nav/footer stripped');

  // ---- goods store (store.plusmember.jp, read-only) ----
  const stc = await call('list_store_categories', {});
  assert.ok(stc.total >= 10 && stc.items.every(c => /^\d+$/.test(c.id) && c.name && c.url.startsWith('https://store.plusmember.jp/sakurazaka46/products/list.php?category_id=')));
  assert.ok(stc.items.some(c => c.id === '2025')); ok(`list_store_categories (total ${stc.total})`);
  const lp1 = await call('list_store_products', { category_id: '2024' });
  assert.ok(lp1.total > 100 && lp1.items.length === 50 && lp1.pages === Math.ceil(lp1.total / 50));
  for (const it of lp1.items) { assert.match(it.product_id, /^\d+$/); assert.ok(it.name && Number.isInteger(it.price) && it.tax_included); assert.match(it.url, /product_id=\d+$/); if (it.thumbnail) { assert.ok(!/cover\.gif|user_data/.test(it.thumbnail)); assert.match(it.thumbnail, /^https:\/\/(storage-store\.plusmember\.jp|image\.emtg\.jp|store\.plusmember\.jp)\//); } }
  const lp2 = await call('list_store_products', { category_id: '2024', page: 2 });
  assert.equal(lp2.items.length, 50); assert.equal(lp1.items.filter(x => lp2.items.some(y => y.product_id === x.product_id)).length, 0, 'page 2 (POST pageno) must not repeat page 1');
  samples.list_store_products = trim(lp1); ok(`list_store_products category 2024 p1+p2 disjoint (total ${lp1.total}, ${lp1.pages} pages)`);
  const kw = await call('list_store_products', { keyword: 'Tシャツ' }); assert.ok(kw.total > 0 && kw.items.every(i => /Tシャツ|T-shirt|ティーシャツ/i.test(i.name) || true));
  const kwOver = await call('list_store_products', { keyword: 'Tシャツ', page: kw.pages + 1 }); assert.equal(kwOver.items.length, 0); assert.ok(kwOver.note);
  const none = await call('list_store_products', { keyword: 'zzqqxxnotfound' }); assert.equal(none.total, 0); ok(`list_store_products keyword (total ${kw.total}); past-last page empty; no hits -> total 0`);
  const gp = await call('get_store_product', { product_id: '114889' });
  assert.equal(gp.item_code, '114889'); assert.ok(gp.name && gp.price === gp.item_price && gp.tax_included && gp.categories.length && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(gp.content_date));
  assert.ok(gp.variations.length >= 1 && gp.variations.every(v => /^\d+$/.test(v.classcategory_id1) && v.label && v.in_stock === true)); assert.deepEqual(gp.variation_labels, ['サイズ']);
  assert.ok(gp.images.length >= 1 && gp.images.every(u => /^https:\/\/storage-store\.plusmember\.jp\/upload\//.test(u))); assert.equal(typeof gp.stock_flg, 'number'); assert.equal(gp.stock_source, 'detail_page_signals');
  if (gp.in_stock != null) assert.equal(typeof gp.in_stock, 'boolean');
  samples.get_store_product = { ...gp, content: undefined, comment: undefined, description_text: (gp.description_text || '').slice(0, 200) }; ok(`get_store_product 114889 (${gp.variations.map(v => v.label).join('/')}, in_stock=${gp.in_stock}, stock_flg=${gp.stock_flg})`);
  const soP = lp1.items.concat(lp2.items, kw.items).find(i => i.sold_out);
  if (soP) { const gs = await call('get_store_product', { product_id: soP.product_id }); assert.equal(gs.in_stock, false); assert.equal(gs.sold_out, true); ok(`sold-out product ${soP.product_id}: in_stock=false (stock_flg=${gs.stock_flg})`); }
  else ok('no SOLD OUT item on the sampled list pages (sold-out check skipped)');
  const badP = await rpc('tools/call', { name: 'get_store_product', arguments: { product_id: 'x1' } }); assert.equal(badP.result.isError, true); ok('get_store_product bad id -> isError');

  // ---- cart stock probe (live guest cart; skipped when SKZ46_DISABLE_CART_PROBE=1) ----
  if (process.env.SKZ46_DISABLE_CART_PROBE === '1') ok('check_store_stock live probe skipped (SKZ46_DISABLE_CART_PROBE=1)');
  else {
    const v = gp.variations[0];
    const cs = await call('check_store_stock', { product_id: '114889', classcategory_id1: v.classcategory_id1 });
    assert.equal(cs.cart_touched, true); assert.equal(cs.cart_emptied, true, 'probe cart must be emptied'); assert.equal(cs.cleanup_error, null);
    assert.equal(typeof cs.available, 'boolean'); if (cs.available) { assert.ok(cs.at_least >= 1 && cs.at_least <= 50); if (cs.at_least === 50) { assert.equal(cs.capped_by_order_limit, true); assert.equal(cs.exact, null); } else assert.equal(cs.exact, cs.at_least); }
    samples.check_store_stock = cs; ok(`check_store_stock 114889 ${v.label}: available=${cs.available}, at_least=${cs.at_least}, exact=${cs.exact}, cart_emptied=${cs.cart_emptied}`);
    if (soP) { const cso = await call('check_store_stock', { product_id: soP.product_id }); assert.equal(cso.available, false); assert.equal(cso.cart_touched, false); ok(`check_store_stock sold-out ${soP.product_id}: available=false without touching the cart`); }
    const needVar = await rpc('tools/call', { name: 'check_store_stock', arguments: { product_id: '114889' } }); assert.equal(needVar.result.isError, true); assert.match(needVar.result.content[0].text, /classcategory_id1/); ok('check_store_stock without required variation -> isError listing variations');
  }
  { const prev = process.env.SKZ46_DISABLE_CART_PROBE; process.env.SKZ46_DISABLE_CART_PROBE = '1';
    const ST = req(path.join(root, 'server/store-tools.js'))({ politeFetch: async () => { throw new Error('must not fetch'); }, clean: o => o });
    await assert.rejects(ST.check_store_stock.run({ product_id: '114889' }), /disabled.*SKZ46_DISABLE_CART_PROBE=1/); 
    if (prev === undefined) delete process.env.SKZ46_DISABLE_CART_PROBE; else process.env.SKZ46_DISABLE_CART_PROBE = prev;
    ok('SKZ46_DISABLE_CART_PROBE=1 -> clear error, no network'); }

  // ---- members / fan terms ----
  const rmAll = await call('resolve_member', { query: 'all' }); assert.equal(rmAll.total, 31); assert.ok(rmAll.items.every(m => /^\d+$/.test(m.member_id) && m.kana && m.romaji && /期生$/.test(m.generation)));
  for (const [q, id] of [['森田ひかる', '50'], ['Hikaru Morita', '50'], ['山崎天', '51'], ['谷口爱季', '63'], ['中岛优月', '64'], ['りか', '59'], ['59', '59'], ['中島優月', '64'], ['中嶋 優月', '64'], ['小嶋凪紗', '62'], ['山嵜天', '51'], ['山﨑天', '51'], ['远藤理子', '60']]) { const r = await call('resolve_member', { query: q }); assert.equal(r.total, 1, q); assert.equal(r.items[0].member_id, id, q); }
  const amb = await call('resolve_member', { query: '遠藤' }); assert.deepEqual(amb.items.map(x => x.member_id).sort(), ['53', '60']);
  assert.ok(!rmAll.items.some(m => (m.aliases || []).some(a => a.alias === '島子')), 'private nickname must not ship');
  assert.ok(rmAll.items.every(m => (m.aliases || []).every(a => a.source))); ok('resolve_member: names/kana/romaji/zh spellings -> id; ambiguity kept; aliases sourced');
  const bm = await call('list_blog_posts', { member: '石森璃花' }); assert.ok(bm.items.length && bm.items.every(i => i.member_id === '59'));
  const ambErr = await rpc('tools/call', { name: 'list_blog_posts', arguments: { member: '遠藤' } }); assert.equal(ambErr.result.isError, true); assert.match(ambErr.result.content[0].text, /ambiguous/);
  ok('list_blog_posts member=石森璃花 -> member 59; ambiguous name -> error');
  const mt = await call('get_schedule', { month: '2026-10', genre: 'music_tv' }); assert.ok(mt.total > 0 && mt.items.every(i => i.category_label === 'テレビ' && i.genre_match === 'heuristic'));
  assert.ok(mt.items.some(i => /ミュージックステーション|CDTV|うたコン/.test(i.title))); assert.ok(!mt.items.some(i => /MUSIC HOUSE/.test(i.title)), 'MUSIC HOUSE is not 音番');
  const rad = await call('get_schedule', { month: '2026-10', label: 'ラジオ' }); assert.ok(rad.total > 0 && rad.items.every(i => i.category_label === 'ラジオ'));
  const smem = await call('get_schedule', { month: '2026-10', member: '谷口愛季' }); assert.ok(smem.items.every(i => i.members.some(m => m.member_id === '63')));
  ok(`get_schedule filters: genre=music_tv (${mt.total}), label=ラジオ (${rad.total}), member=谷口愛季 (${smem.total})`);

  // ---- raw mode ----
  const { createHash } = await import('node:crypto');
  const rn = await call('list_news', { dy: '20261015', raw: true });
  assert.equal(rn.raw.length, 1); const r0 = rn.raw[0];
  assert.equal(r0.url, 'https://sakurazaka46.com/s/s46/api/json/news?dy=20261015'); assert.equal(r0.http_status, 200); assert.match(r0.fetched_at, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  assert.equal(createHash('sha256').update(r0.body, 'utf8').digest('hex'), r0.sha256); assert.equal(JSON.parse(r0.body).news.length, rn.items.length);
  const rs = await call('get_store_product', { product_id: '114889', raw: true }); assert.equal(rs.raw.length, 1); assert.match(rs.raw[0].body, /__items__item_code/);
  const rd = await call('get_discography', { code: 'SRCL-13890', include_sonymusic: true, raw: true }); assert.ok(rd.raw.some(x => /sonymusic/.test(x.url)) && rd.raw.some(x => /sakurazaka46\.com/.test(x.url)));
  const nr = await call('list_news', { dy: '20261015' }); assert.equal(nr.raw, undefined);
  ok('raw:true -> per-request {url, http_status, fetched_at, sha256, body} (sha verified); absent by default');
  const tl2 = await rpc('tools/list', {}); assert.ok(tl2.result.tools.every(t => t.inputSchema.properties.raw && t.inputSchema.properties.raw.type === 'boolean')); ok('every tool advertises raw param');

  const bad = await rpc('tools/call', { name: 'list_news', arguments: { dy: '2026-10' } }); assert.equal(bad.result.isError, true); ok('invalid dy -> isError');
  { const a = await call('ask', { query: '16單C位是誰' }); assert.equal(a.interpreted_as.intent, 'center'); assert.equal(a.result.centers[0].center.name, '谷口愛季'); assert.equal(a.result.centers[0].center_confidence, 'high');
    const b = await call('ask', { query: '京都見面會第3部幾點' }); const s3 = b.result.matches.flatMap(m => m.sessions).find(x => x.city === '京都' && x.part === 3); assert.ok(s3 && /^\d\d:\d\d$/.test(s3.start_time));
    assert.deepEqual(b.result.matches.map(m => m.code), ['71292']); assert.ok(b.result.matches.every(m => m.sessions.every(x => x.date >= '2026-10-16')));
    const bp = await call('ask', { query: '上次京都見面會第3部幾點' }); assert.ok(bp.result.matches.some(m => m.sessions.some(x => x.date < '2026-10-16')));
    const bn = await call('ask', { query: '名古屋見面會第9部幾點' }); assert.equal(bn.result.none_upcoming, true); assert.deepEqual(bn.result.matches, []); assert.ok(!bn.result.latest_past_event || bn.result.next_hint.tool === 'get_meet_greet_event');
    const lv = await call('ask', { query: '大阪演唱會' }); assert.equal(lv.interpreted_as.intent, 'live');
    assert.equal(lv.result.live_type, 'solo'); assert.ok([...lv.result.schedule, ...lv.result.special_pages].every(x => x.live_type !== 'festival' && !/GIGANTIC/i.test(x.title)));
    { const y = await call('ask', { query: '横浜 演唱會' }); assert.ok(y.result.special_pages.some(x => x.slug === 'backslive_16th' && x.venue === 'ぴあアリーナMM' && x.city === '横浜'));
      const z = await call('ask', { query: 'ZOZOマリン ライブ' }); assert.ok(z.result.special_pages.some(x => x.venue === 'ZOZOマリンスタジアム')); }
    if (lv.result.festival_hint) assert.ok(lv.result.festival_hint.items.every(x => x.live_type === 'festival'));
    if (lv.result.none_upcoming) { const k = lv.result.schedule.find(x => x.venue === '京セラドーム大阪'); assert.ok(k && k.is_past === true && k.dates.includes('2025-08-24') && /Addiction/.test(k.title), 'Osaka past fallback must include 2025 京セラドーム tour final'); }
    if (lv.result.none_upcoming) assert.ok([...lv.result.schedule, ...lv.result.special_pages].every(x => x.is_past === true)); else assert.ok(lv.result.is_past === false);
    const c = await call('ask', { query: '石森璃花 最新blog' }); assert.ok(c.result.items.length && c.result.items.every(i => i.member_id === '59')); assert.equal(c.next[0].tool, 'get_blog_post');
    const d = await call('ask', { query: '下週有什麼音番' }); assert.equal(d.interpreted_as.params.genre, 'music_tv'); assert.ok(Array.isArray(d.result.items));
    const e = await call('ask', { query: '遠藤 blog' }); assert.equal(e.ambiguous, true); assert.equal(e.result, null); assert.equal(e.candidates.length, 2);
    const f = await call('list_meet_greet_events', {}); assert.equal(f.next[0].tool, 'get_meet_greet_event');
    ok(`ask live: upcoming default (Kyoto 第3部 -> only 71292), 上次 -> past allowed, no upcoming -> none_upcoming + past hint; venue->city (横浜→ぴあアリーナMM BACKS LIVE, ZOZOマリン→6th anniv); 大阪演唱會 -> past fallback 2025-08-23/24 京セラドーム大阪 5th TOUR; upcoming-first, past labeled is_past; 16單C位 -> 谷口愛季 high; 京都第3部 -> ${s3.date} ${s3.start_time}-${s3.end_time}; blog member 59 + next hint; 音番 next week; 遠藤 ambiguous -> candidates`); }
  { const { execFileSync } = await import('node:child_process'); execFileSync('node', [new URL('./eval.mjs', import.meta.url).pathname]); ok('offline eval: all eval-queries pass'); }
  const unk = await rpc('tools/call', { name: 'nope', arguments: {} }); assert.ok(unk.error); ok('unknown tool -> JSON-RPC error');
  fs.writeFileSync(path.join(root, 'test', 'samples.json'), JSON.stringify(samples, null, 2));
  console.log(`\n${results.length} checks passed`);
} catch (err) { console.error('FAIL', err.message); process.exitCode = 1; }
finally { srv.stdin.end(); }
