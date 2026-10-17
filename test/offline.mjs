// Offline tests with mocked upstreams (no network): call deadline, request timeout, news size defaults, cart probe
// quantity/cleanup, stdout drain on stdin EOF. Usage: node test/offline.mjs   (smoke.mjs runs it too)
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url'; import path from 'node:path'; import fs from 'node:fs'; import os from 'node:os';
import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const req = createRequire(import.meta.url);
const results = []; const ok = n => { results.push(n); console.log('PASS', n); };

function server(env) {
  const srv = spawn('node', ['-r', path.join(root, 'test/mock-fetch.cjs'), path.join(root, 'server/index.js')], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, ...env } });
  let buf = '', nid = 0; const pend = new Map();
  srv.stdout.on('data', c => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); pend.get(m.id)?.(m); pend.delete(m.id); } });
  const rpc = (method, params) => new Promise(r => { const id = ++nid; pend.set(id, r); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const call = async (name, args) => { const t0 = Date.now(); const m = await rpc('tools/call', { name, arguments: args }); return { ms: Date.now() - t0, isError: m.result.isError, out: m.result.structuredContent, text: m.result.content[0].text, bytes: Buffer.byteLength(m.result.content[0].text) }; };
  return { srv, rpc, call, close: () => srv.stdin.end() };
}
const prevMonth = m => { let [y, mo] = m.split('-').map(Number); if (--mo < 1) { mo = 12; y--; } return `${y}-${String(mo).padStart(2, '0')}`; };

try {
  // ---- 1. whole-call deadline with an empty upstream (no matches anywhere) ----
  { const log = path.join(os.tmpdir(), `skz46-mock-${process.pid}.log`); fs.rmSync(log, { force: true });
    const s = server({ MOCK_FETCH: 'empty', SKZ46_DEADLINE_MS: '8000', MOCK_LOG: log });
    const lv = await s.call('ask', { query: '大阪演唱會' });
    assert.equal(lv.isError, false, lv.text); const r = lv.out.result;
    assert.ok(lv.ms < 9500, `ask returned after ${lv.ms} ms (deadline 8000)`);
    assert.equal(r.truncated_by_deadline, true); assert.equal(r.truncated, true); assert.equal(r.history_complete, false); assert.equal(r.stop_reason, 'deadline');
    assert.ok(r.searched_range && /^\d{4}-\d{2}$/.test(r.searched_range.from) && r.searched_range.to >= r.searched_range.from);
    assert.equal(r.continue_before, r.searched_range.from); assert.match(r.note, /NOT searched/); assert.deepEqual(r.schedule, []);
    assert.equal(lv.out.next[0].tool, 'ask'); assert.equal(lv.out.next[0].params.before, r.continue_before); assert.equal(lv.out.next[0].params.query, '大阪演唱會');
    ok(`deadline: no-match live search returns in ${lv.ms} ms (deadline 8000) with truncated_by_deadline, searched_range ${r.searched_range.from}..${r.searched_range.to}, next.before=${r.continue_before}`);
    const c2 = await s.call('ask', lv.out.next[0].params);
    assert.equal(c2.isError, false, c2.text); assert.equal(c2.out.result.continued_before, r.continue_before); assert.equal(c2.out.result.searched_range.to, prevMonth(r.continue_before));
    assert.ok(c2.out.result.searched_range.from < r.searched_range.from); assert.ok(c2.ms < 9500);
    ok(`deadline: continuation with before=${r.continue_before} walks older months ${c2.out.result.searched_range.from}..${c2.out.result.searched_range.to} in ${c2.ms} ms`);
    const sc = await s.call('ask', { query: 'ラジオ 行程' });
    assert.equal(sc.isError, false, sc.text); assert.equal(sc.out.interpreted_as.intent, 'schedule');
    assert.equal(sc.out.result.truncated_by_deadline, true); assert.deepEqual(sc.out.result.past_fallback, []); assert.ok(sc.out.result.searched_range); assert.ok(sc.ms < 9500);
    assert.equal(sc.out.next[0].params.before, sc.out.result.continue_before);
    ok(`deadline: no-match schedule past fallback returns in ${sc.ms} ms, truncated_by_deadline, searched ${sc.out.result.searched_range.from}..${sc.out.result.searched_range.to}`);
    s.close(); await new Promise(r => s.srv.on('exit', r));
    const ts = fs.readFileSync(log, 'utf8').trim().split('\n').map(l => Number(l.split(' ')[0]));
    const gaps = ts.slice(1).map((t, i) => t - ts[i]); assert.ok(Math.min(...gaps) >= 995, `min gap ${Math.min(...gaps)} ms`);
    ok(`spacing kept under deadline: ${ts.length} mock requests, min gap ${Math.min(...gaps)} ms`); fs.rmSync(log, { force: true }); }

  // ---- 2. per-request timeout and deadline with a hanging upstream ----
  { const s = server({ MOCK_FETCH: 'hang', SKZ46_FETCH_TIMEOUT_MS: '1000', SKZ46_DEADLINE_MS: '30000' });
    const g = await s.call('get_schedule', {});
    assert.equal(g.isError, true); assert.match(g.text, /upstream timeout after 1000 ms/); assert.ok(g.ms < 2500, `${g.ms} ms`);
    ok(`request timeout: hanging upstream aborted after ${g.ms} ms (SKZ46_FETCH_TIMEOUT_MS=1000)`); s.close(); }
  { const s = server({ MOCK_FETCH: 'hang', SKZ46_FETCH_TIMEOUT_MS: '15000', SKZ46_DEADLINE_MS: '3000' });
    const g = await s.call('get_formation', {});
    assert.equal(g.isError, true); assert.match(g.text, /deadline/); assert.match(g.text, /NOT a "no results" answer/); assert.ok(g.ms < 3600, `${g.ms} ms`);
    ok(`deadline caps a single slow request: error after ${g.ms} ms (deadline 3000), says it is not "no results"`);
    const sp = await s.call('list_special_pages', {}); assert.equal(sp.isError, true); assert.ok(sp.ms < 3600); s.close(); }

  // ---- 3. list_news size defaults, paging and byte cap (200 mock articles x ~10 KB) ----
  { const s = server({ MOCK_FETCH: 'empty' });
    const d = await s.call('list_news', {});
    assert.equal(d.isError, false, d.text); assert.equal(d.out.items.length, 20); assert.equal(d.out.total, 200); assert.equal(d.out.has_more, true);
    assert.ok(d.out.items.every(i => !('content' in i) && typeof i.content_excerpt === 'string' && i.content_excerpt.length <= 121 && 'tags' in i && 'caption' in i && 'category_label' in i && 'pubdate' in i));
    assert.ok(d.bytes < 30000, `${d.bytes} bytes`); assert.deepEqual(d.out.next[0].params, { offset: 20 });
    ok(`list_news default: 20 short items, ${d.bytes} bytes (no content; tags/caption/category_label/pubdate kept), next offset 20`);
    const f = await s.call('list_news', { include_content: true, limit: 200 });
    assert.equal(f.out.truncated, true); assert.ok(f.out.items_bytes <= 600000 && f.out.items.length < 200 && f.out.items.length > 10); assert.ok(f.out.items.every(i => typeof i.content === 'string'));
    assert.equal(f.out.next[0].params.offset, f.out.items.length); assert.match(f.out.truncated_reason, /max_bytes/);
    ok(`list_news include_content limit 200: byte cap -> ${f.out.items.length} items, ${f.bytes} bytes, truncated + next offset ${f.out.items.length}`);
    const big = await s.call('list_news', { include_content: true, limit: 200, max_bytes: 5000000 });
    assert.equal(big.out.items.length, 200); assert.equal(big.out.truncated, false); assert.equal(big.out.next, null);
    const pg = await s.call('list_news', { offset: 190, limit: 20 }); assert.equal(pg.out.items.length, 10); assert.equal(pg.out.has_more, false); assert.equal(pg.out.items[0].id, '70190');
    const rw = await s.call('list_news', { raw: true }); assert.equal(rw.out.raw.length, 1); assert.equal(JSON.parse(rw.out.raw[0].body).news.length, 200); assert.ok(Buffer.byteLength(rw.out.raw[0].body) > 1e6);
    const bad = await s.call('list_news', { limit: 201 }); assert.equal(bad.isError, true);
    ok('list_news opt-in: max_bytes raises the cap (200 full items), offset paging, raw body never cut, limit>200 rejected');
    s.close(); }

  // ---- 4. stdout is drained when the client closes stdin right after sending ----
  { const srv = spawn('node', ['-r', path.join(root, 'test/mock-fetch.cjs'), path.join(root, 'server/index.js')], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, MOCK_FETCH: 'empty' } });
    let out = ''; srv.stdout.on('data', c => out += c);
    const msgs = [1, 2, 3].map(id => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'list_news', arguments: { include_content: true, limit: 200, max_bytes: 5000000 } } }) + '\n');
    srv.stdin.end(msgs.join(''));
    await new Promise(r => srv.on('close', r));
    const lines = out.split('\n').filter(Boolean); assert.equal(lines.length, 3); for (const l of lines) assert.equal(JSON.parse(l).result.structuredContent.items.length, 200);
    ok(`stdin EOF right after 3 requests: all 3 replies complete (${(out.length / 1e6).toFixed(1)} MB), then exit`); }

  // ---- 5. cart probe: probe_quantity and cleanup reporting (fake store, in-process) ----
  { const ST = opts => {
      const st = { cart: [], posted: [], ignore: [], stock: opts.stock ?? 100 };
      const detail = '<div class="__items__item_code">1</div><div class="__items__name">Towel</div><div id="detailrightblock"><a onclick="fnCheckSubmit()">カートに入れる</a></div>';
      const cartHtml = () => st.cart.length ? st.cart.map((l, i) => `<p class="product-name">${l.name}</p><ul><li class="product-num">${l.q}</li></ul><a onclick="fnFormModeSubmit('form1', 'delete', 'cart_no', '${i + 1}')">x</a>`).join('') + '<input name="cartKey" value="1">' : '<p>現在カート内に商品はありません</p>';
      const politeFetch = async (url, as, o = {}) => { st.ignore.push(!!o.ignoreDeadline);
        if (/detail\.php/.test(url) && !o.form) return { status: 200, text: detail };
        if (/detail\.php/.test(url) && o.form) { st.posted.push(o.form.quantity); if (opts.addThrows) throw Object.assign(new Error('upstream timeout'), { code: 'TIMEOUT' }); st.cart.push({ name: 'Towel', q: Math.min(Number(o.form.quantity), st.stock) }); return { status: 302, location: 'cart/index.php?transactionid=ab', text: '' }; }
        if (/cart\/index\.php/.test(url) && o.form && o.form.mode === 'delete') { if (!opts.failDelete) st.cart.splice(Number(o.form.cart_no) - 1, 1); return { status: 302, text: '' }; }
        if (/cart\/index\.php/.test(url)) return { status: 200, text: cartHtml() };
        throw new Error('unexpected ' + url); };
      return { st, tool: req(path.join(root, 'server/store-tools.js'))({ politeFetch, clean: o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === undefined || v === '' ? null : v])) }).check_store_stock };
    };
    { const { st, tool } = ST({}); const r = await tool.run({ product_id: '1' });
      assert.deepEqual(st.posted, ['1']); assert.equal(r.requested_quantity, 1); assert.equal(r.available, true); assert.equal(r.at_least, 1); assert.equal(r.exact, null); assert.equal(r.capped_by_order_limit, false);
      assert.equal(r.cart_cleanup, 'ok'); assert.equal(r.cart_emptied, true); assert.equal(r.cleanup_attempts, 1); assert.equal(st.cart.length, 0);
      ok('probe default: quantity 1 posted -> available yes/no, cart_cleanup ok after 1 round'); }
    { const { st, tool } = ST({ stock: 7 }); const r = await tool.run({ product_id: '1', probe_quantity: 50 });
      assert.deepEqual(st.posted, ['50']); assert.equal(r.at_least, 7); assert.equal(r.exact, 7); assert.match(r.exact_basis, /reduced the requested 50 to 7/);
      const r2 = await ST({ stock: 100 }).tool.run({ product_id: '1', probe_quantity: 50 }); assert.equal(r2.at_least, 50); assert.equal(r2.capped_by_order_limit, true); assert.equal(r2.exact, null);
      const r3 = await ST({ stock: 100 }).tool.run({ product_id: '1', probe_quantity: 5 }); assert.equal(r3.at_least, 5); assert.equal(r3.exact, null); assert.equal(r3.capped_by_order_limit, false);
      await assert.rejects(ST({}).tool.run({ product_id: '1', probe_quantity: 51 }), /probe_quantity must be an integer 1\.\.50/);
      await assert.rejects(ST({}).tool.run({ product_id: '1', probe_quantity: 0 }), /probe_quantity/);
      ok('probe_quantity opt-in: 50 with stock 7 -> exact 7; 50 with stock 100 -> at_least 50 capped; 5 -> at_least 5; 0/51 rejected'); }
    { const { st, tool } = ST({ failDelete: true }); const r = await tool.run({ product_id: '1' });
      assert.equal(r.cart_cleanup, 'failed'); assert.equal(r.cart_emptied, false); assert.equal(r.cleanup_attempts, 3); assert.match(r.cleanup_error, /still in the guest cart after 3 delete round/); assert.ok(r.cleanup_note);
      assert.ok(st.ignore.slice(-5).every(Boolean), 'cleanup requests must ignore the call deadline');
      ok('cleanup failure is reported: cart_cleanup failed after 3 retried delete rounds (cleanup ignores the call deadline)'); }
    { const { st, tool } = ST({ addThrows: true }); await assert.rejects(tool.run({ product_id: '1' }), /stock probe failed: upstream timeout; cart_cleanup=ok/);
      ok('probe error during add -> error that still states cart_cleanup'); }
  }
  // special page / blog caps
  { const SP = req(path.join(root, 'server/special-tools.js'))({ politeFetch: async () => `<html><body><main><p>${'あ'.repeat(30000)}</p></main></body></html>`, clean: o => o, ORIGIN: 'https://sakurazaka46.com' });
    const a = await SP.get_special_page.run({ slug: 'x', max_chars: 1000 }); assert.equal(a.text.length, 1000); assert.equal(a.truncated, true); assert.equal(a.text_length, 30000);
    const H = req(path.join(root, 'server/html-tools.js'))({ politeFetch: async () => `<h1 class="title">T</h1><div class="box-article"><p>${'い'.repeat(30000)}</p></div><div class="blog-foot"><p class="name">N</p></div>`, abs: x => x, jstIso: x => x, clean: o => o, ORIGIN: '' });
    const b = await H.get_blog_post.run({ id: '1' }); assert.equal(b.body_text.length, 20000); assert.equal(b.body_truncated, true); assert.equal(b.body_length, 30000);
    const b2 = await H.get_blog_post.run({ id: '1', max_chars: 100000 }); assert.equal(b2.body_truncated, false);
    ok('body caps: get_special_page/get_blog_post max_chars (default 20k) with truncated flag + full length'); }
  console.log(`\n${results.length} offline checks passed`);
} catch (err) { console.error("FAIL", err.stack || err.message); process.exitCode = 1; }
finally { setTimeout(() => process.exit(), 200).unref(); }
