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
  if (/storage-store\.plusmember\.jp\//.test(u)) { // product images: tiny PNG; 'big' -> 600 KB; 'fail' -> 404; 'html' -> not an image
    if (/fail/.test(u)) return new Response('no', { status: 404 });
    if (/html/.test(u)) return new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } });
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
    const body = /big/.test(u) ? Buffer.concat([png, Buffer.alloc(600000)]) : png;
    return new Response(body, { status: 200, headers: { 'content-type': /\.jpg/.test(u) ? 'image/jpeg' : 'image/png', 'content-length': String(body.length) } });
  }
  if (/store\.plusmember\.jp\/sakurazaka46\/products\/detail\.php/.test(u)) {
    const id = new URL(u).searchParams.get('product_id');
    return html(`<div class="__items__item_code">${id}</div><div class="__items__name">Mock ${id}</div><div class="__items__price">2500</div><div class="__items__img_url">https://storage-store.plusmember.jp/upload/save_image/main_${id}.png</div><div id="detailphotoblock"><img src="https://storage-store.plusmember.jp/upload/save_image/main_${id}.png"></div><div id="detailrightblock"><p class="price">¥2,500 （税込）</p><a onclick="fnCheckSubmit()">カートに入れる</a></div>`);
  }
  if (/store\.plusmember\.jp\/sakurazaka46\/products\/list\.php/.test(u)) { // EC-CUBE name search: AND of space-separated substrings
    const CAT = [['901', '【通常配送】6th Anniversary 推しメンマフラータオル 石森 璃花'], ['902', '【通常配送】ARENA TOUR 2026 推しメンマフラータオル 石森 璃花'], ['903', '【通常配送】6th Anniversary 推しメンマフラータオル 山﨑 天'],
      ['904', '【通常配送】アクリルスタンドキーホルダー 石森 璃花'], ['905', '【通常配送】生写真5枚セット 6th Anniversary'], ['906', '【通常配送】6th Anniversary 推しメンマフラータオル 中嶋 優月']];
    const kw = (new URL(u).searchParams.get('name') || '').normalize('NFKC'); const terms = kw.split(/\s+/).filter(Boolean);
    const hits = CAT.filter(([, n]) => terms.every(t => n.normalize('NFKC').includes(t)));
    const lis = hits.map(([id, n]) => `<li class="x"><!--★画像★--><a href="detail.php?product_id=${id}"><img src="https://storage-store.plusmember.jp/upload/save_image/${id === '902' ? 'big' : id === '904' ? 'fail' : 'thumb'}_${id}.png"></a><p class="tit">${n}</p><p class="price">¥2,500 （税込）</p></li>`).join('');
    return html(`<p class="item-num">全<span>${hits.length}</span>件</p>` + (hits.length ? `<ul class="list--item">${lis}</ul><div class="block--pager"></div>` : '<p>お探しの商品は見つかりませんでした</p>'));
  }
  return new Response('not found', { status: 404 });
};
