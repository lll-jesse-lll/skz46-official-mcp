'use strict';
// Official goods store: store.plusmember.jp/sakurazaka46 (EC-CUBE 2). HTML only; no JSON API exists.
// Read-only: GET pages, plus the list page's own POST paging form (pageno). Never touches the cart.
const { extractImages, cleanImageUrl } = require('./images.js');
const STORE = 'https://store.plusmember.jp/sakurazaka46';
const PER_PAGE = 50; // the store's default page size

module.exports = function makeStoreTools({ politeFetch, clean }) {
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', yen: '¥' };
  const decode = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e.toLowerCase()] ?? m));
  const text = h => decode(String(h).replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const textBr = h => decode(String(h).replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ''))
    .split('\n').map(l => l.replace(/[ \t\u00a0]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const changed = (what, url) => new Error(`page structure changed: ${what} not found at ${url}`);
  const yen = s => { const m = /([\d,]+)/.exec(s || ''); return m ? Number(m[1].replace(/,/g, '')) : undefined; };
  const sImg = u => cleanImageUrl(u, STORE + '/', { store: true });
  const ne = a => (a && a.length ? a : undefined);
  const iconsOf = h => [...String(h).matchAll(/<li class="ico--([\w-]+)[^"]*">([\s\S]*?)<\/li>/g)].map(([, cls, label]) => ({ cls, label: text(label) }));
  const labelsOf = icons => ne([...new Set(icons.map(i => i.label).filter(Boolean))]);

  const list_store_categories = {
    description: 'List categories of the official Sakurazaka46 goods store (store.plusmember.jp), from the site menu: id, name, level, url. Use the id with list_store_products.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    async run() {
      const url = `${STORE}/`;
      const html = await politeFetch(url, 'text');
      const out = []; const seen = new Set();
      for (const m of html.matchAll(/<li class="nav--category__item level(\d+)[^"]*">\s*<a href="[^"]*list\.php\?category_id=(\d+)[^"]*">([\s\S]*?)<\/a>/g)) {
        if (seen.has(m[2])) continue; seen.add(m[2]);
        out.push({ id: m[2], name: text(m[3]), level: Number(m[1]), url: `${STORE}/products/list.php?category_id=${m[2]}` });
      }
      if (!out.length) throw changed('category menu (li.nav--category__item)', url);
      return { total: out.length, items: out };
    } };

  function parseListItems(html) {
    const st = html.indexOf('<ul class="list--item">'); if (st < 0) return undefined;
    const rest = html.slice(st); const en = rest.search(/<div class="block--pager|<\/form>/);
    const ul = en > 0 ? rest.slice(0, en) : rest;
    const items = [];
    for (const li of ul.split(/<li\b[^>]*>\s*<!--★画像★-->/).slice(1)) {
      const id = (/detail\.php\?product_id=(\d+)/.exec(li) || [])[1]; if (!id) continue;
      const icons = iconsOf(li);
      const price_text = text((/<p class="price">([\s\S]*?)<\/p>/.exec(li) || [])[1] || '');
      items.push(clean({ product_id: id, name: text((/<p class="tit"[^>]*>([\s\S]*?)<\/p>/.exec(li) || [])[1] || ''),
        url: `${STORE}/products/detail.php?product_id=${id}`,
        thumbnail: extractImages(li, { backgrounds: true, store: true, base: STORE + '/' })[0],
        price: yen(price_text), price_text: price_text || undefined, tax_included: /税込/.test(price_text) || undefined,
        labels: labelsOf(icons), sold_out: icons.some(i => i.cls === 'sold-out') || undefined,
        sub_text: text((/<p class="txt--sub">([\s\S]*?)<\/p>/.exec(li) || [])[1] || '') || undefined }));
    }
    return items;
  }

  const list_store_products = {
    description: 'List products in the official goods store (50 per page, newest first): product_id, name, tax-included price, thumbnail, labels (e.g. NEW, 通常配送, SOLD OUT), sold_out. Filter by category_id (from list_store_categories) and/or keyword; page >= 1.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      category_id: { type: 'string', pattern: '^\\d+$', description: 'Store category id, e.g. "2024" (【通常配送】ALL ITEMS).' },
      keyword: { type: 'string', maxLength: 80, description: 'Search words (the store\'s name search).' },
      page: { type: 'integer', minimum: 1, description: 'Page number (default 1). Pages after 1 use the store\'s POST paging form.' } } },
    async run(a) {
      if (a.category_id !== undefined && !/^\d+$/.test(String(a.category_id))) throw new Error('category_id must be digits');
      const page = a.page === undefined ? 1 : Number(a.page);
      if (!Number.isInteger(page) || page < 1) throw new Error('page must be an integer >= 1');
      const q = new URLSearchParams(); if (a.category_id) q.set('category_id', String(a.category_id)); if (a.keyword) q.set('name', String(a.keyword));
      let url = `${STORE}/products/list.php${q.toString() ? '?' + q : ''}`; let html;
      if (page === 1) html = await politeFetch(url, 'text');
      else { // EC-CUBE 2 ignores GET pageno; it pages via the list form (POST pageno). Read-only.
        const pq = new URLSearchParams({ __shop_key: 'sakurazaka46' }); for (const [k, v] of q) pq.set(k, v);
        url = `${STORE}/products/list.php?${pq}`;
        html = await politeFetch(url, 'text', { form: { pageno: String(page), mode: '', sort_save: '2', disp_number: String(PER_PAGE), ...(a.keyword ? { name: String(a.keyword) } : {}) } });
      }
      const items = parseListItems(html);
      if (items === undefined) { if (/該当件数.*0|商品が見つかりません|お探しの商品は見つかりませんでした/.test(html) || /item-num">全<span>0<\/span>/.test(html)) return { total: 0, page, items: [] }; throw changed('product list (ul.list--item)', url); }
      const total = yen((/<p class="item-num">全<span>([\d,]+)<\/span>件/.exec(html) || [])[1]);
      const category_name = text((/<p class="section-tit">([\s\S]*?)<\/p>/.exec(html) || [])[1] || '');
      const pages = total !== undefined ? Math.max(1, Math.ceil(total / PER_PAGE)) : undefined;
      // the store silently returns page 1 for an out-of-range pageno; don't repeat those items
      if (pages !== undefined && page > pages) return clean({ total, page, per_page: PER_PAGE, pages, category_name: category_name || undefined, items: [], note: `page ${page} is past the last page (${pages})` });
      return clean({ total, page, per_page: PER_PAGE, pages, category_name: category_name || undefined, items });
    } };

  const arr = s => [...String(s).matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(m => decode(m[1].replace(/\\'/g, "'")));

  const get_store_product = {
    description: 'One goods-store product: item fields (item_code, name, price, categories, content, content_date, weight, stock_flg), displayed tax-included price, images, variations (e.g. sizes) and public stock signals (in_stock, sold-out label, listed variations). No numeric stock counts are public.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['product_id'], properties: { product_id: { type: 'string', pattern: '^\\d+$', description: 'Store product id, e.g. "114889".' } } },
    async run(a) {
      const id = String(a.product_id || ''); if (!/^\d+$/.test(id)) throw new Error('product_id must be digits');
      const url = `${STORE}/products/detail.php?product_id=${id}`;
      const html = await politeFetch(url, 'text');
      const f = name => { const m = [...html.matchAll(new RegExp(`<div class="__items__${name}">([\\s\\S]*?)<\\/div>`, 'g'))].map(x => decode(x[1]).trim()); return m; };
      if (!f('item_code').length) { if (/商品が見つかりません|ご指定の商品|エラー/.test(html) && !/detailarea/.test(html)) throw new Error(`product ${id} not found`); throw changed('hidden item block (div.__items__item_code)', url); }
      const one = n => f(n)[0] || undefined;
      const right = html.slice(html.indexOf('id="detailrightblock"') >= 0 ? html.indexOf('id="detailrightblock"') : 0);
      const head = right.slice(0, right.search(/<!--★カゴに入れるボタン★-->|<div class="block--comment">/) > 0 ? right.search(/<!--★カゴに入れるボタン★-->|<div class="block--comment">/) + 600 : 6000);
      const icons = iconsOf(head);
      const price_text = text((/<p class="price">([\s\S]*?)<\/p>/.exec(head) || [])[1] || '');
      const cartButton = /fnCheckSubmit\(\)[^>]*>\s*カートに入れる/.test(html);
      const soldLabel = icons.some(i => i.cls === 'sold-out');
      // variations: class 1 options are in the HTML; class 2 options live in JS arrays lists<id>/vals<id>, indexed by class-1 position
      const variations = [];
      const sel1 = /<select name="classcategory_id1"[\s\S]*?<\/select>/.exec(html);
      const dtLabels = [...(head.match(/<dl class="list--choice">([\s\S]*?)<\/dl>/) || ['', ''])[1].matchAll(/<dt>([\s\S]*?)<\/dt>/g)].map(m => text(m[1]));
      if (sel1) {
        const opts1 = [...sel1[0].matchAll(/<option label="([^"]*)" value="(\d+)"/g)].map(m => ({ label: decode(m[1]), value: m[2] }));
        const lists = {}, vals = {};
        for (const m of html.matchAll(new RegExp(`list${id}_(\\d+) = new Array\\(([^)]*)\\)`, 'g'))) lists[m[1]] = arr(m[2]);
        for (const m of html.matchAll(new RegExp(`val${id}_(\\d+) = new Array\\(([^)]*)\\)`, 'g'))) vals[m[1]] = arr(m[2]);
        const hasSel2 = /<select name="classcategory_id2"/.test(html);
        opts1.forEach((o, i) => {
          const l2 = (lists[i + 1] || []).slice(1), v2 = (vals[i + 1] || []).slice(1);
          const second = hasSel2 ? l2.map((label, j) => ({ label, value: v2[j] })).filter(x => x.label && x.value && x.value !== '0') : [];
          if (second.length) for (const s2 of second) variations.push({ classcategory_id1: o.value, classcategory_id2: s2.value, label: `${o.label} / ${s2.label}`, in_stock: true });
          else variations.push({ classcategory_id1: o.value, label: o.label, in_stock: true });
        });
      }
      const images = extractImages(html.slice(html.indexOf('id="detailphotoblock"'), html.indexOf('id="detailrightblock"')), { store: true, base: STORE + '/' });
      const imgUrl = sImg(one('img_url'));
      const in_stock = soldLabel ? false : cartButton ? true : undefined;
      const sales = (/販売開始<\/p>([\s\S]*?)<\/div>/.exec(html) || [])[1];
      return clean({
        product_id: id, item_code: one('item_code'), name: one('name'), url,
        price: yen(price_text), price_text: price_text || undefined, tax_included: /税込/.test(price_text) || undefined,
        item_price: one('price') !== undefined && /^\d+$/.test(one('price')) ? Number(one('price')) : undefined,
        categories: ne(f('category')), labels: labelsOf(icons),
        comment: one('comment'), content: one('content'), content_date: one('content_date'),
        sales_start_text: sales ? text(sales) : undefined,
        weight: one('weight') !== undefined && /^\d+(\.\d+)?$/.test(one('weight')) ? Number(one('weight')) : undefined,
        image: imgUrl, images: ne(images),
        variation_labels: ne(dtLabels.filter(l => l && l !== '個数')),
        variations: ne(variations),
        in_stock, sold_out: soldLabel || undefined,
        stock_flg: one('stock_flg') !== undefined ? Number(one('stock_flg')) : undefined,
        stock_source: 'detail_page_signals',
        stock_note: 'in_stock comes from the SOLD OUT label / presence of the add-to-cart button. Sold-out variations are removed from the selector by the store, so only purchasable variations are listed. stock_flg is the store\'s raw, undocumented flag (do not interpret it as a count). Numeric stock is not public.',
        description_text: (() => { const d = (/<div class="block--comment">([\s\S]*?)<ul id="sns">/.exec(html) || [])[1]; return d ? textBr(d) : undefined; })() });
    } };

  // ---------- check_store_stock (guest-cart probe; enabled by default, opt-out SKZ46_DISABLE_CART_PROBE=1) ----------
  // Adds the per-order cap (50) to a fresh, isolated guest cart, reads what the cart accepted, then ALWAYS deletes every
  // line and verifies the cart is empty. Never proceeds to checkout, never logs in, never sends personal data.
  const ORDER_CAP = 50;
  const cartText = h => text(String(h).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ''));
  function parseCart(html) {
    const lines = [...html.matchAll(/<p class="product-name">([\s\S]*?)<\/p>([\s\S]*?)<li class="product-num">\s*(\d+)\s*<\/li>[\s\S]*?fnFormModeSubmit\('([^']+)', 'delete', 'cart_no', '(\d+)'\)/g)]
      .map(m => ({ name: text(m[1]), variation: text(m[2].split('<p class="product-price">')[0]) || null, quantity: Number(m[3]), form: m[4], cart_no: m[5] }));
    const messages = [...html.matchAll(/<p class="attention">([\s\S]*?)<\/p>/g)].flatMap(m => m[1].split(/<br\s*\/?>/i)).map(x => text(x)).filter(Boolean);
    const cartKey = (/name="cartKey" value="(\d+)"/.exec(html) || [])[1];
    const empty = /現在カート内に商品はありません/.test(html);
    return { lines, messages, cartKey, empty };
  }
  const check_store_stock = {
    description: 'Probe goods-store stock with a temporary guest cart: adds the per-order cap (50) of one product/variation to a fresh isolated guest cart on the LIVE store, reads what was accepted, then always empties the cart and verifies it. Answers "is it available, and is at least N in stock". Exact counts only if the store reduces the quantity below the cap. Never checks out. Disabled when SKZ46_DISABLE_CART_PROBE=1.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['product_id'], properties: {
      product_id: { type: 'string', pattern: '^\\d+$', description: 'Store product id.' },
      classcategory_id1: { type: 'string', pattern: '^\\d+$', description: 'Variation id (from get_store_product variations[].classcategory_id1). Required when the product has variations.' },
      classcategory_id2: { type: 'string', pattern: '^\\d+$', description: 'Second-level variation id when the product has one.' } } },
    async run(a) {
      if (process.env.SKZ46_DISABLE_CART_PROBE === '1') throw new Error('check_store_stock is disabled on this server (SKZ46_DISABLE_CART_PROBE=1). It works by adding items to a temporary guest cart on the live store; unset the variable to allow it.');
      const id = String(a.product_id || ''); if (!/^\d+$/.test(id)) throw new Error('product_id must be digits');
      const jar = new Map(); // isolated per call
      const get = u => politeFetch(u, 'response', { jar });
      const post = (u, form) => politeFetch(u, 'response', { jar, form });
      const detailUrl = `${STORE}/products/detail.php?product_id=${id}`;
      const d = await get(detailUrl);
      if (d.status !== 200 || !/__items__item_code/.test(d.text)) throw new Error(`product ${id} not found (HTTP ${d.status})`);
      const name = decode((/<div class="__items__name">([\s\S]*?)<\/div>/.exec(d.text) || [])[1] || '').trim() || null;
      const sel1 = /<select name="classcategory_id1"[\s\S]*?<\/select>/.exec(d.text);
      const opts1 = sel1 ? [...sel1[0].matchAll(/<option label="([^"]*)" value="(\d+)"/g)].map(m => ({ label: decode(m[1]), value: m[2] })) : [];
      const hasCart = /fnCheckSubmit\(\)[^>]*>\s*カートに入れる/.test(d.text);
      const soldLabel = /<li class="ico--sold-out/.test(d.text.slice(d.text.indexOf('id="detailrightblock"')));
      const base = { product_id: id, name, classcategory_id1: a.classcategory_id1 || null, classcategory_id2: a.classcategory_id2 || null, requested_quantity: ORDER_CAP, probe: 'guest_cart' };
      if (soldLabel || !hasCart) return clean({ ...base, available: false, at_least: 0, exact: soldLabel ? 0 : null, capped_by_order_limit: false,
        message_raw: soldLabel ? 'SOLD OUT label on the product page; no add-to-cart button (cart not touched)' : 'no add-to-cart button (cart not touched)', cart_emptied: true, cart_touched: false });
      if (sel1 && !a.classcategory_id1) throw new Error(`product ${id} has variations; pass classcategory_id1: ${opts1.map(o => `${o.label}=${o.value}`).join(', ')}`);
      if (/<select name="classcategory_id2"/.test(d.text) && !a.classcategory_id2) throw new Error(`product ${id} has a second variation level; pass classcategory_id2 (see get_store_product variations)`);
      const listed = !a.classcategory_id1 || opts1.some(o => o.value === String(a.classcategory_id1));
      let result, cart_emptied = false, cleanupError = null, token = null, cartKey = null;
      try {
        const add = await post(`${detailUrl}&sales_id=`, { mode: 'cart', product_id: id, favorite_product_id: '', hdnBuyGrp: '1', quantity: String(ORDER_CAP),
          ...(a.classcategory_id1 ? { classcategory_id1: String(a.classcategory_id1) } : {}), ...(a.classcategory_id2 ? { classcategory_id2: String(a.classcategory_id2) } : {}) });
        token = (/transactionid=([0-9a-f]+)/.exec(add.location || '') || [])[1] || null;
        const addMsg = add.status === 200 ? [...add.text.matchAll(/<p class="attention">([\s\S]*?)<\/p>|<span class="attention">([\s\S]*?)<\/span>/g)].map(m => text(m[1] || m[2])).filter(Boolean) : [];
        const c = await get(`${STORE}/cart/index.php`);
        const cart = parseCart(c.text); cartKey = cart.cartKey;
        const line = cart.lines.find(l => l.name === name) || cart.lines[0];
        const msgs = [...addMsg, ...cart.messages];
        const qty = line ? line.quantity : 0;
        const soldMsg = msgs.some(m => /売り切れ/.test(m));
        const capMsg = msgs.find(m => /一度に購入できる数量は(\d+)まで|一度に数量(\d+)以上の購入はできません/.test(m));
        const capN = capMsg ? Number((/(\d+)/.exec(capMsg.replace(/[^0-9]+/g, ' ').trim()) || [])[1]) : null;
        result = { available: qty > 0, at_least: qty, // the cart accepted this many, so at least this many are in stock
          // exact only when the cart cut the quantity below the order cap (store limited it by stock), or the store said it is sold out
          exact: soldMsg && qty === 0 ? 0 : qty > 0 && qty < ORDER_CAP ? qty : null,
          exact_basis: soldMsg && qty === 0 ? 'store message: sold out' : qty > 0 && qty < ORDER_CAP ? `cart reduced the requested ${ORDER_CAP} to ${qty} (below the order cap)` : null,
          capped_by_order_limit: qty === ORDER_CAP || (capN !== null && capN >= ORDER_CAP && qty === capN),
          order_limit: capN, variation_listed_on_page: listed, message_raw: msgs.join(' / ') || null, cart_line: line || null };
      } finally {
        // ALWAYS empty the guest cart, then verify
        try {
          for (let round = 0; round < 3; round++) {
            const c = await get(`${STORE}/cart/index.php`); const cart = parseCart(c.text);
            if (cart.empty || !cart.lines.length) { cart_emptied = cart.empty || !cart.lines.length; break; }
            cartKey = cart.cartKey || cartKey;
            for (const l of [...cart.lines].sort((x, y) => Number(y.cart_no) - Number(x.cart_no)))
              await post(`${STORE}/cart/index.php`, { transactionid: token || '', mode: 'delete', cart_no: l.cart_no, cartKey: cartKey || '' });
          }
        } catch (e) { cleanupError = e.message; }
      }
      return clean({ ...base, ...result, cart_emptied, cart_touched: true, cleanup_error: cleanupError,
        reservation_note: 'Adding to cart does not reserve stock on this store (product pages: 「ご注文確定するまでは、カートに商品が入っていても在庫は確保されていません」); the probe cart is emptied right away.' });
    } };

  return { list_store_categories, list_store_products, get_store_product, check_store_stock };
};
