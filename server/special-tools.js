'use strict';
// Special pages (/s/s46/page/<slug>): discovery from the LIVE and ARCHIVE lists, plus generic page reader.
// The pages are hand-built landing pages with no common schema, so get_special_page returns generic
// text/images/links/videos instead of hard-parsed fields.
const { extractImages, cleanImageUrl } = require('./images.js');
const TEXT_CAP = 20000;
const SLUG = /^[A-Za-z0-9_-]+$/;

module.exports = function makeSpecialTools({ politeFetch, clean, ORIGIN }) {
  const S46 = ORIGIN + '/s/s46';
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const decode = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e.toLowerCase()] ?? m));
  const text = h => decode(String(h).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  const dotDate = s => { const m = /(\d{4})[./](\d{1,2})[./](\d{1,2})/.exec(s || ''); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : undefined; };
  const absUrl = u => { try { const x = new URL(decode(u).trim(), ORIGIN); return /^https?:$/.test(x.protocol) ? x : undefined; } catch { return undefined; } };
  const slugOf = href => { const x = absUrl(href); if (!x || !/(^|\.)sakurazaka46\.com$/.test(x.hostname)) return; const m = /^\/s\/s46\/page\/([A-Za-z0-9_-]+)\/?$/.exec(x.pathname); return m ? m[1] : undefined; };
  const mainOf = html => { const i = html.indexOf('<main'), j = html.lastIndexOf('</main>'); return i >= 0 && j > i ? html.slice(i, j) : undefined; };

  // Parse list items: each <li> holding an <a href=".../page/<slug>">.
  function parseList(html, source) {
    const main = mainOf(html);
    if (!main) throw new Error(`page structure changed: <main> not found on ${source} list`);
    const out = [];
    for (const li of main.split(/<li\b/i).slice(1)) {
      const href = (/<a\b[^>]*href="([^"]+)"/i.exec(li) || [])[1]; const slug = href && slugOf(href); if (!slug) continue;
      const title = text((/<h3[^>]*>([\s\S]*?)<\/h3>/i.exec(li) || [])[1] || '');
      const date = dotDate(text((/<p class="date[^"]*">([\s\S]*?)<\/p>/i.exec(li) || [])[1] || '')) || dotDate(text((/<h4 class="txt">([\s\S]*?)<\/h4>/i.exec(li) || [])[1] || ''));
      const thumbnail = extractImages(li, { backgrounds: true })[0];
      out.push(clean({ slug, title: title || undefined, date, url: `${S46}/page/${slug}?ima=0000`, source, thumbnail }));
    }
    return out;
  }

  const list_special_pages = {
    description: 'Discover official special pages (/s/s46/page/<slug>: live sites, single/anniversary specials) from the LIVE and ARCHIVE lists. Returns slug, title, date, url, source, thumbnail. Use get_special_page to read one.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    async run() {
      const live = parseList(await politeFetch(`${S46}/diary/live_page/list?ima=0000`, 'text'), 'live');
      const first = await politeFetch(`${S46}/diary/archive/list?ima=0000&cd=archive`, 'text');
      let archive = parseList(first, 'archive');
      const maxPage = Math.max(0, ...[...first.matchAll(/archive\/list\?[^"]*?page=(\d+)/g)].map(m => Number(m[1])));
      const seen = new Set(archive.map(x => x.slug));
      for (let p = 1; p <= Math.min(maxPage, 30); p++) {
        const items = parseList(await politeFetch(`${S46}/diary/archive/list?ima=0000&page=${p}&cd=archive`, 'text'), 'archive');
        for (const it of items) if (!seen.has(it.slug)) { seen.add(it.slug); archive.push(it); }
      }
      // de-dupe: live first, then archive entries not already listed (keep the extra fields if missing)
      const by = new Map();
      for (const it of [...live, ...archive]) { const prev = by.get(it.slug); if (!prev) by.set(it.slug, it); else for (const k of ['title', 'date', 'thumbnail']) if (prev[k] == null && it[k] != null) prev[k] = it[k]; }
      const items = [...by.values()];
      return { total: items.length, live_count: live.length, archive_pages: maxPage + 1, items };
    } };

  const get_special_page = {
    description: 'Read one official special page (/s/s46/page/<slug>) as generic content: title, plain text (headings and line breaks kept, site chrome removed, capped at 20k chars), filtered content images, links and embedded videos. Slug from list_special_pages.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['slug'], properties: { slug: { type: 'string', pattern: SLUG.source, description: 'Page slug, e.g. "backslive_16th" or "16th_single".' } } },
    async run(a) {
      const slug = String(a.slug || '');
      if (!SLUG.test(slug)) throw new Error('slug must match /^[A-Za-z0-9_-]+$/');
      const url = `${S46}/page/${slug}?ima=0000`;
      const html = await politeFetch(url, 'text');
      const title = decode((/<title>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || (/<meta property="og:title" content="([^"]*)"/i.exec(html) || [])[1] || '').replace(/\s+/g, ' ').trim();
      // whole <body> (hero/KV images often sit outside <main>), minus header/footer/nav/scripts/cookie/share below
      let region = (/<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html) || [])[1] || mainOf(html);
      if (!region) throw new Error(`page structure changed: no <main>/<body> at ${url}`);
      const ot = region.search(/<div id="onetrust-/i); if (ot >= 0) region = region.slice(0, ot);
      region = region
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<(script|style|noscript|svg|iframe|template)\b[\s\S]*?<\/\1>/gi, m => (/<iframe\b/i.test(m) ? m.replace(/<\/?iframe/gi, '<x-iframe') : ''))
        .replace(/<(footer|nav)\b[\s\S]*?<\/\1>/gi, '')
        // a <header> is site chrome only when it carries navigation; landing pages use <header> for the hero/KV
        .replace(/<header\b[\s\S]*?<\/header>/gi, m => (/<nav\b|nav_toggle|gnav|global-?nav|menu/i.test(m) ? '' : m))
        .replace(/<ul\b[^>]*class="[^"]*\b(share[\w-]*|sns[\w-]*)\b[^"]*"[\s\S]*?<\/ul>/gi, '');
      // videos (before stripping): YouTube embeds/links/thumbnails, Brightcove players
      const yt = new Set(); for (const m of region.matchAll(/(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=|shorts\/)|youtu\.be\/|img\.youtube\.com\/vi\/|i\.ytimg\.com\/vi\/)([\w-]{11})/g)) yt.add(m[1]);
      const videos = [...yt].map(id => ({ provider: 'youtube', id, url: `https://www.youtube.com/watch?v=${id}` }));
      const bc = new Set(); for (const m of region.matchAll(/<(?:video|video-js)\b[^>]*>/gi)) { const id = (/data-video-id="(\d+)"/.exec(m[0]) || [])[1]; const acc = (/data-account="(\d+)"/.exec(m[0]) || [])[1]; if (id && !bc.has(id)) { bc.add(id); videos.push(clean({ provider: 'brightcove', id, account: acc })); } }
      const images = extractImages(region, { backgrounds: true });
      const links = []; const seenL = new Set();
      for (const m of region.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
        const x = absUrl(m[1]); if (!x) continue;
        if (/sakurazaka46\.com$/.test(x.hostname)) x.searchParams.delete('ima');
        const u = x.toString().replace(/\?$/, ''); if (seenL.has(u)) continue; seenL.add(u);
        links.push(clean({ url: u, text: text(m[2]) || undefined, external: !/(^|\.)sakurazaka46\.com$/.test(x.hostname) || undefined }));
      }
      let body = decode(region.replace(/<x-iframe[\s\S]*?<\/x-iframe>/gi, '')
        .replace(/<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (m, n, t) => `\n\n${'#'.repeat(Number(n))} ${t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}\n`)
        .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|dt|dd|tr|section|ul|dl|table)>/gi, '\n').replace(/<(li)\b[^>]*>/gi, '\n・').replace(/<[^>]+>/g, ''))
        .split('\n').map(l => l.replace(/[ \t\u00a0\u3000]+/g, ' ').trim()).filter((l, i, arr) => l || (arr[i - 1] || '')).join('\n')
        .replace(/^#+\s*$/gm, '').replace(/^・\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
      const truncated = body.length > TEXT_CAP;
      if (truncated) body = body.slice(0, TEXT_CAP);
      return clean({ slug, url, title: title || undefined, text: body, truncated: truncated || undefined, text_length: truncated ? undefined : body.length,
        images: images.length ? images : undefined, links: links.length ? links : undefined, videos: videos.length ? videos : undefined });
    } };

  return { list_special_pages, get_special_page };
};
