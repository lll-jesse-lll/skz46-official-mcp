'use strict';
// HTML-scraping tools. Zero dependencies: small regex helpers only.
// Every parser throws "page structure changed" when an expected anchor is missing.

const { extractImages, cleanImageUrl } = require('./images.js');
const { memberIdFrom } = require('./members.js');
module.exports = function makeHtmlTools({ politeFetch, abs, jstIso, clean, ORIGIN }) {
  const S46 = ORIGIN + '/s/s46';

  // ---------- helpers ----------
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
  const decode = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e.toLowerCase()] ?? m));
  const text = html => decode(String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')).replace(/[ \t\u00a0]+/g, ' ').trim();
  const textWithBreaks = html => decode(String(html)
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6])>/gi, '\n').replace(/<[^>]+>/g, ''))
    .split('\n').map(l => l.replace(/[ \t\u00a0]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const changed = (what, url) => new Error(`page structure changed: ${what} not found at ${url}`);
  const first = (re, s) => { const m = re.exec(s); return m ? m[1] : undefined; };
  const dotDate = s => { const m = /(\d{4})[./](\d{1,2})[./](\d{1,2})/.exec(s || ''); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : undefined; };
  const bgUrl = s => first(/background-image:\s*url\(\s*['"]?([^'")]+)['"]?\s*\)/i, s || '');
  const nonEmpty = a => (a && a.length ? a : undefined);
  const memberLinks = html => [...String(html).matchAll(/<a[^>]+href="[^"]*\/artist\/([^"?/]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g)]
    .map(([, id, n]) => clean({ member_id: /^\d+$/.test(id) ? id : undefined, name: text(n) }));


  // ---------- meet&greet session text parsing ----------
  const z2h = t => String(t).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/：/g, ':')
    .replace(/[〜～~－―ー−]/g, m => (m === 'ー' ? m : '~')).replace(/[（]/g, '(').replace(/[）]/g, ')').replace(/[＜〈]/g, '<').replace(/[＞〉]/g, '>').replace(/[\u3000\u00a0]/g, ' ');
  const T = '(\\d{1,2}:\\d{2})';
  const jpDate = t => { const m = /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/.exec(t); return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : undefined; };
  function parseSessionLine(line) {
    const L = z2h(line);
    const part = /第\s*(\d+)\s*部/.exec(L); if (!part) return undefined;
    const get = re => { const m = re.exec(L); return m ? m[1] : undefined; };
    let reception_start = get(new RegExp('受付開始\\s*' + T)), reception_end = get(new RegExp('受付終了\\s*' + T));
    let start_time = get(new RegExp('(?:イベント)?開始\\s*' + T + '(?![^/]*受付)')), end_time = get(new RegExp(T + '\\s*終了予定')) || get(new RegExp('(?<!受付)(?:イベント)?終了\\s*' + T));
    if (start_time === reception_start && /受付開始/.test(L)) start_time = get(new RegExp('イベント開始\\s*' + T));
    const range = new RegExp(T + '\\s*~\\s*' + T).exec(L);
    if (range && !start_time) { start_time = range[1]; if (!end_time) end_time = range[2]; }
    if (!start_time && !end_time && !reception_start) return undefined;
    return clean({ part: Number(part[1]), start_time, end_time, reception_start, reception_end, raw_text: line.trim() });
  }
  // Parses venue blocks (●/■ XX会場, 開催日:, 会場:) and shared 【日程】 date lists; never invents values.
  function parseSessions(bodyText, fallbackDate) {
    const lines = String(bodyText).split('\n');
    const out = []; let section, venue_label, venue, date, pendingDate = false, inDates = false, sharedDates = [];
    const reset = () => { venue_label = venue = date = undefined; sharedDates = []; pendingDate = inDates = false; };
    for (const raw of lines) {
      const line = z2h(raw).trim();
      if (!line) { inDates = false; continue; }
      if (/^★/.test(line)) { reset(); section = line.replace(/^★+/, '').trim(); continue; } // a new sub-event on the same page
      if (pendingDate) { pendingDate = false; const d = jpDate(line); if (d) { date = d; continue; } }
      const vb = /^[●■◆□◇]\s*(.+?会場)\s*$/.exec(line);
      if (vb) { venue_label = vb[1]; venue = undefined; date = undefined; continue; }
      const dl = /^(?:開催日程|開催日|日程)\s*:\s*(.*)$/.exec(line);
      if (dl) { const d = jpDate(dl[1]); if (d) date = d; else if (!dl[1].trim()) pendingDate = true; continue; }
      const vl = /^(?:開催会場|会場)\s*:\s*(.+)$/.exec(line);
      if (vl) { venue = vl[1].trim(); continue; }
      if (/^【日程】/.test(line)) { inDates = true; sharedDates = []; continue; }
      if (inDates) { const d = jpDate(line); if (d) { sharedDates.push(d); continue; } inDates = false; }
      const ses = parseSessionLine(raw);
      if (!ses) continue;
      const base = { section, venue_label, city: venue_label ? venue_label.replace(/会場$/, '') : undefined, venue };
      const dates = date ? [date] : sharedDates.length ? sharedDates : fallbackDate ? [fallbackDate] : [undefined];
      for (const d of dates) {
        const row = clean({ date: d, ...base, ...ses });
        // the same part may be described twice (e.g. 開催時間 range + reception schedule): merge, never overwrite
        const prev = out.find(o => o.part === row.part && o.date === row.date && o.venue_label === row.venue_label && o.section === row.section);
        if (prev) { for (const [k, v] of Object.entries(row)) if (k === 'raw_text') prev.raw_text += ' / ' + v; else if (prev[k] == null) prev[k] = v; }
        else out.push(row);
      }
    }
    return out.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || a.part - b.part);
  }



  // ---------- get_meet_greet_event ----------
  const get_meet_greet_event = {
    description: 'Details of one MEET&GREET event page (code from list_meet_greet_events): venues/dates, per-part (第N部) session times incl. reception times, member lanes, full text.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['code'], properties: { code: { type: 'string', pattern: '^\\d+$', description: 'Event code, e.g. "71292".' } } },
    async run(a) {
      if (!/^\d+$/.test(String(a.code || ''))) throw new Error('code must be digits');
      const url = `${S46}/diary/detail/${a.code}?ima=0000&cd=event_page`;
      const html = await politeFetch(url, 'text');
      const title = text(first(/<h1 class="title">([\s\S]*?)<\/h1>/, html) || '');
      if (!title) throw changed('event title (h1.title)', url);
      const bi = html.indexOf('<div class="col-r post-body">');
      if (bi < 0) throw changed('event body (div.col-r.post-body)', url);
      const ei = html.indexOf('</article>', bi);
      const bodyHtml = html.slice(bi, ei > 0 ? ei : bi + 60000);
      const body_text = textWithBreaks(bodyHtml);
      const listed = text(first(/<p class="[^"]*title-date[^"]*">([\s\S]*?)<\/p>/, html) || '');
      // member lanes: lines after 【レーン詳細】 until a blank line / next 【
      let members;
      const names = [];
      for (const hdr of ['【レーン詳細】', '【参加メンバー】']) {
        let li = body_text.indexOf(hdr);
        while (li >= 0) {
          const block = body_text.slice(li + hdr.length).split(/\n\s*\n|\n(?=【)/)[0];
          for (const ln of block.split('\n')) { if (/^※|第\s*\d+\s*部|…/.test(ln)) continue;
            names.push(...ln.split(/[,、，]/).map(x => x.trim()).filter(x => x && x.length <= 10 && !/[※:：0-9０-９&]/.test(x))); }
          li = body_text.indexOf(hdr, li + hdr.length);
        }
      }
      members = nonEmpty([...new Set(names)]);
      return clean({ code: String(a.code), title, url, category: text(first(/<div class="com-eventico">[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/, html) || ''),
        listed_date: dotDate(listed), images: nonEmpty(extractImages(bodyHtml)), sessions: nonEmpty(parseSessions(body_text)), members, body_text });
    } };

  // Heuristic, deliberately conservative music-program title list (音番): core music shows only. A title match, not an
  // official genre. THE TIME, is included at the owner's request; MUSIC HOUSE is excluded at the owner's request (not 音番).
  const MUSIC_TV = /ミュージックステーション|Mステ|MUSIC STATION|CDTV|うたコン|THE TIME,|ベストアーティスト|FNS歌謡祭|Venue101|THE MUSIC DAY|音楽の日|紅白歌合戦|ミュージックフェア|Love music/i;

  // ---------- get_schedule ----------
  function parseScheduleArray(html, url) {
    const start = html.indexOf('var scheduleEvents = [');
    if (start < 0) throw changed('scheduleEvents array', url);
    const end = html.indexOf('];', start);
    if (end < 0) throw changed('end of scheduleEvents array', url);
    const body = html.slice(start, end);
    return [...body.matchAll(/\{([\s\S]*?)\}/g)].map(([, obj]) => {
      const o = {};
      for (const [, k, v] of obj.matchAll(/(\w+)\s*:\s*'((?:\\.|[^'\\])*)'/g)) o[k] = v.replace(/\\(.)/g, '$1');
      return o;
    }).filter(o => o.title && o.start);
  }
  function modalFor(html, anchor) {
    const key = `js-schedule-detail ${anchor}"`;
    const i = html.indexOf(key);
    if (i < 0) return undefined;
    const j = html.indexOf('js-schedule-detail ', i + key.length);
    return html.slice(i, j > 0 ? j : i + 6000);
  }
  const get_schedule = {
    description: 'Official schedule (TV/radio/magazine appearances, events, releases, meet&greet, birthdays) from the SCHEDULE page. One month per call; filter by date, category, label (テレビ/ラジオ/雑誌/配信/WEBメディア/新聞/ライブ/イベント...), member (name/alias), keyword, or genre=music_tv (音番/音楽番組; heuristic title match).',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'YYYY-MM-DD: only events on this day.' },
      month: { type: 'string', pattern: '^\\d{4}-\\d{2}$', description: 'YYYY-MM. Default: the current month (site default).' },
      category: { type: 'string', description: 'Category code, e.g. media, event, release, shakehands, birthday (observed values).' },
      label: { type: 'string', description: 'Exact category_label as shown on the site, e.g. テレビ, ラジオ, 雑誌, 配信, WEBメディア, 新聞, ライブ, イベント, 誕生日.' },
      member: { type: 'string', description: 'Only events listing this member (id, name, kana, romaji or alias).' },
      keyword: { type: 'string', description: 'Case-insensitive substring of title or description.' },
      genre: { type: 'string', enum: ['music_tv'], description: 'Heuristic: music_tv = TV items whose title matches a music-program keyword list (core shows only: Mステ/CDTV/うたコン/THE TIME,/ベストアーティスト/FNS歌謡祭/Venue101/THE MUSIC DAY/紅白...). Results carry genre_match:"heuristic".' } } },
    async run(a) {
      if (a.date && a.month) throw new Error('give either date or month, not both');
      if (a.date && !/^\d{4}-\d{2}-\d{2}$/.test(a.date)) throw new Error('date must be YYYY-MM-DD');
      if (a.month && !/^\d{4}-\d{2}$/.test(a.month)) throw new Error('month must be YYYY-MM');
      // Verified: dy=YYYYMM returns that month; dy=YYYYMMDD also returns the WHOLE month of that day, so day filtering is client-side.
      const dy = a.date ? a.date.replace(/-/g, '') : a.month ? a.month.replace('-', '') : '';
      const url = `${S46}/media/list?ima=0000${dy ? '&dy=' + dy : ''}`;
      const html = await politeFetch(url, 'text');
      let events = parseScheduleArray(html, url);
      const wantMonth = a.date ? a.date.slice(0, 7) : a.month;
      if (wantMonth && events.length && !events.some(e => e.start.startsWith(wantMonth))) throw new Error(`upstream returned no events for ${wantMonth} (page may have ignored dy)`);
      if (a.date) events = events.filter(e => e.start === a.date);
      if (a.category) events = events.filter(e => e.className === a.category);
      let items = events.map(e => {
        const anchor = (e.url || '').replace(/^#/, '');
        const m = anchor ? modalFor(html, anchor) : undefined;
        let start_time, end_time, category_label, members, description, links;
        if (m) {
          const dateTxt = text(first(/<p class="date[^"]*">([\s\S]*?)<\/p>/, m) || '');
          const t = /(\d{1,2}:\d{2})\s*[～〜~\-]\s*(\d{1,2}:\d{2})?/.exec(dateTxt);
          if (t) { start_time = t[1]; end_time = t[2]; }
          category_label = text(first(/<p class="type">([\s\S]*?)<\/p>/, m) || '');
          members = nonEmpty(memberLinks(first(/<ul class="members[^"]*">([\s\S]*?)<\/ul>/, m) || ''));
          const lead = first(/<p class="lead">([\s\S]*?)<\/p>\s*<\/div>/, m) || first(/<p class="lead">([\s\S]*?)<\/p>/, m) || '';
          description = textWithBreaks(lead);
          links = nonEmpty([...new Set([...lead.matchAll(/href="([^"]+)"/g)].map(x => abs(decode(x[1]))))]);
        }
        const sessions = description && /第\s*[0-9０-９]+\s*部/.test(description) ? nonEmpty(parseSessions(description, e.start).map(x => ({ ...x, date: e.start }))) : undefined;
        return clean({ date: e.start, start_time, end_time, title: decode(e.title), category: e.className, category_label, members, description, sessions,
          links, url: `${S46}/media/list?ima=0000&dy=${e.start.replace(/-/g, '')}` });
      });
      if (a.label) items = items.filter(i => i.category_label === a.label);
      if (a.member) { const id = memberIdFrom(a.member); items = items.filter(i => (i.members || []).some(m => m.member_id === id)); }
      if (a.keyword) { const k = String(a.keyword).toLowerCase(); items = items.filter(i => (i.title + '\n' + (i.description || '')).toLowerCase().includes(k)); }
      if (a.genre === 'music_tv') items = items.filter(i => i.category_label === 'テレビ' && MUSIC_TV.test(i.title)).map(i => ({ ...i, genre_match: 'heuristic' }));
      else if (a.genre !== undefined) throw new Error('genre must be music_tv');
      return clean({ month: wantMonth || (events[0] && events[0].start.slice(0, 7)), date: a.date, total: items.length, items });
    } };

  // ---------- get_formation ----------
  // Center: inferred from the middle of an odd-sized front row (the page has no explicit marker);
  // upgraded to 'official' only via the static, hand-verified evidence map shipped with the package.
  const EVIDENCE = (() => { try { return require('./center-evidence.json').entries || {}; } catch { return {}; } })();
  const nameKey = n => String(n || '').replace(/[\s　]/g, '');
  function centerFor(num, kind, titles, rows, infer) {
    const front = rows.front || [];
    const middle = front.length % 2 === 1 ? front[(front.length - 1) / 2] : undefined;
    const ev = kind === 'single' ? titles.map(t => EVIDENCE[`${num}|${t}`]).find(Boolean) : undefined;
    if (ev) {
      const all = Object.values(rows).flat();
      const m = all.find(x => nameKey(x.name) === nameKey(ev.name));
      const center = m ? clean({ member_id: m.member_id, name: m.name }) : { name: ev.name };
      return clean({ center, center_source: 'official', center_confidence: 'high', center_evidence: { url: ev.url, quote: ev.quote },
        center_note: middle && nameKey(middle.name) !== nameKey(ev.name) ? `official center differs from front-row middle (${middle.name})` : undefined });
    }
    // Position-based inference is opt-in (infer_center: true); by default only official evidence yields a center.
    if (!infer || !middle) return clean({ center: undefined, center_source: undefined, center_confidence: undefined });
    return { center: clean({ member_id: middle.member_id, name: middle.name }), center_source: 'front_row_middle', center_confidence: 'medium' };
  }

  function parseFormation(html, url, infer = false) {
    const parts = html.split(/<div class="list_wrap\b/).slice(1);
    if (!parts.length) throw changed('formation list_wrap blocks', url);
    return parts.map(p => {
      const h = /<h3>\s*<span>\s*(\d+)(?:st|nd|rd|th)\s*(シングル|アルバム)\s*<\/span>([\s\S]*?)<span>([^<]*)<\/span>/.exec(p);
      if (!h) throw changed('release heading (h3)', url);
      const kind = h[2] === 'シングル' ? 'single' : 'album';
      const codes = [...new Set([...(first(/<div class="jacket">([\s\S]*?)<\/div>/, p) || '').matchAll(/discography\/([A-Z0-9-]+)/g)].map(x => x[1]))];
      const songs = p.split(/<div class="formation_image">/).slice(1).map(chunk => {
        const rows = {};
        // row <ul> may carry extra classes (e.g. "third custom01") and there can be a 4th row
        for (const [, row, inner] of chunk.matchAll(/<ul class="(front|second|third|fourth)(?:\s[^"]*)?">([\s\S]*?)<\/ul>/g))
          rows[row] = [...inner.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(([, li]) => clean({
            member_id: first(/\/artist\/(\d+)/, li), name: text(first(/<i>([\s\S]*?)<\/i>/, li) || '') }));
        const h4 = first(/<h4>([\s\S]*?)<\/h4>/, chunk) || '';
        const titles = [...h4.matchAll(/「([^」]*)」/g)].map(m => text(m[1]));
        return clean({ title: text(h4.replace(/<br\s*\/?>/gi, ' ')).replace(/^「|」$/g, ''), song_titles: titles.length > 1 ? titles : undefined, rows,
          ...centerFor(Number(h[1]), kind, titles.length ? titles : [text(h4).replace(/^「|」$/g, '')], rows, infer) });
      });
      return clean({ kind, single_number: kind === 'single' ? Number(h[1]) : undefined, album_number: kind === 'album' ? Number(h[1]) : undefined,
        title: text(h[3]).replace(/^「|」$/g, ''), release_date: dotDate(h[4]), discography_code: codes[0], discography_codes: nonEmpty(codes),
        rows: songs[0] && songs[0].rows, songs: nonEmpty(songs) });
    });
  }
  // The formation page's jacket links are unreliable (e.g. 16th single links to 15th-single codes).
  // Resolve codes from the official discography list by type + release_date (+ title check).
  const norm = t => String(t || '').replace(/【[^】]*】/g, '').replace(/[\s「」『』"“”'’]/g, '').toLowerCase();
  async function resolveCodes(r) {
    const { discography_code: rawCode, discography_codes: rawCodes, ...rest } = r;
    let list;
    try { list = await fetchDiscographyList(); }
    catch (e) { return clean({ ...rest, note: `could not verify discography codes (${e.message}); site jacket links omitted` }); }
    const type = r.kind === 'single' ? 'SINGLE' : 'ALBUM';
    const byDate = list.filter(i => i.type === type && i.release_date === r.release_date);
    const byTitle = byDate.filter(i => { const a = norm(i.title), b = norm(r.title); return a && b && (a.includes(b) || b.includes(a)); });
    const codes = (byTitle.length ? byTitle : byDate).map(i => i.code);
    if (!codes.length) return clean({ ...rest, note: 'no matching release found in official discography list; site jacket links omitted' });
    const agrees = (rawCodes || []).length > 0 && rawCodes.every(c => codes.includes(c));
    return clean({ ...rest, discography_code: codes[0], discography_codes: codes,
      note: rawCodes && rawCodes.length && !agrees ? `formation page jacket links (${rawCodes.join(', ')}) were wrong; codes resolved from official discography list` : undefined });
  }
  const get_formation = {
    description: 'Member formation (front/second/third rows) per single from the FORMATION page. Default: latest single; set single=N for the Nth single; list=true for a summary of all singles/albums.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {
      single: { type: 'integer', minimum: 1, description: 'Single number, e.g. 16.' },
      album: { type: 'integer', minimum: 1, description: 'Album number, e.g. 2 (instead of single).' },
      list: { type: 'boolean', default: false, description: 'Return a summary of every single/album (no rows).' },
      infer_center: { type: 'boolean', default: false, description: 'Opt-in: when no official center evidence exists, infer center from the middle of an odd-sized front row (center_source front_row_middle, confidence medium). Off by default.' } } },
    async run(a) {
      const url = `${S46}/page/formation?ima=0000`;
      const all = parseFormation(await politeFetch(url, 'text'), url, a.infer_center === true);
      if (a.list) {
        const items = [];
        for (const r0 of all) { const r = await resolveCodes(r0); items.push(clean({ kind: r.kind, single_number: r.single_number, album_number: r.album_number,
          title: r.title, release_date: r.release_date, discography_code: r.discography_code, note: r.note,
          center: r.songs && r.songs[0] && r.songs[0].center, center_source: r.songs && r.songs[0] && r.songs[0].center_source, songs: nonEmpty((r.songs || []).map(s => s.title)) })); }
        return { total: items.length, items, source: url };
      }
      if (a.album !== undefined) {
        const al = all.find(x => x.kind === 'album' && x.album_number === a.album);
        if (!al) throw new Error(`album ${a.album} not found; available: ${all.filter(x => x.kind === 'album').map(x => x.album_number).join(', ')}`);
        return { ...(await resolveCodes(al)), source: url };
      }
      const singles = all.filter(r => r.kind === 'single');
      const r = a.single === undefined ? singles.sort((x, y) => y.single_number - x.single_number)[0] : singles.find(x => x.single_number === a.single);
      if (!r) throw new Error(`single ${a.single} not found; available: ${singles.map(x => x.single_number).sort((x, y) => x - y).join(', ')}`);
      return { ...(await resolveCodes(r)), source: url };
    } };

  // ---------- get_blog_post ----------
  const get_blog_post = {
    description: 'Full text of one member blog post (plain text with line breaks) plus image URLs. Use after list_blog_posts to read a post.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string', pattern: '^\\d+$', description: 'Blog post id, e.g. "71404".' } } },
    async run(a) {
      if (!/^\d+$/.test(String(a.id || ''))) throw new Error('id must be digits');
      const url = `${S46}/diary/detail/${a.id}?ima=0000&cd=blog`;
      const html = await politeFetch(url, 'text');
      const bi = html.indexOf('<div class="box-article">');
      if (bi < 0) throw changed('blog article body (div.box-article)', url);
      const fi = html.indexOf('<div class="blog-foot">', bi);
      if (fi < 0) throw changed('blog footer (div.blog-foot)', url);
      const body = html.slice(bi + '<div class="box-article">'.length, fi);
      const foot = html.slice(fi, fi + 3000);
      const title = text(first(/<h1 class="title">([\s\S]*?)<\/h1>/, html) || '');
      if (!title) throw changed('blog title (h1.title)', url);
      return clean({ id: String(a.id), title,
        member_id: first(/class="btn-type3 pos-center"><a href="[^"]*[?&]ct=(\d+)/, foot),
        member_name: text(first(/<p class="name">([\s\S]*?)<\/p>/, foot) || ''),
        published_at: jstIso(text(first(/<p class="date[^"]*">([\s\S]*?)<\/p>/, foot) || '')),
        url, body_text: textWithBreaks(body.replace(/<\/div>\s*$/, '')),
        images: nonEmpty(extractImages(body)) });
    } };

  // ---------- discography ----------
  // Sony returns one `discs` entry per track (same disc_number repeated); merge them per disc.
  function groupDiscs(discs) {
    const by = new Map();
    for (const d of discs || []) {
      const n = d.disc_number; if (!by.has(n)) by.set(n, { disc_number: n, title: '', tracks: [] });
      const g = by.get(n); if (!g.title && d.title) g.title = decode(d.title).trim();
      for (const t of d.contents || []) g.tracks.push(clean({ track_number: t.track_number, title: decode(t.title || '').trim() }));
    }
    return nonEmpty([...by.values()].map(g => clean({ ...g, tracks: nonEmpty(g.tracks) })));
  }

  let discoCache; // per-process cache of the official discography list
  function fetchDiscographyList() {
    if (!discoCache) discoCache = (async () => {
      const url = `${S46}/artist/00/discography?ima=0000`;
      const html = await politeFetch(url, 'text');
      const items = [...html.matchAll(/<li class="box">\s*<a href="[^"]*\/discography\/([A-Z0-9-]+)[^"]*">([\s\S]*?)<\/a>\s*<\/li>/g)].map(([, code, inner]) => {
        const dates = [...inner.matchAll(/<p class="date[^"]*">([\s\S]*?)<\/p>/g)].map(m => text(m[1]));
        return clean({ code, title: text(first(/<h3 class="title">([\s\S]*?)<\/h3>/, inner) || ''), type: text(first(/<p class="type">([\s\S]*?)<\/p>/, inner) || ''),
          release_date: dotDate(dates[0]), price_text: dates.find(d => /円/.test(d)), jacket: cleanImageUrl(abs(bgUrl(inner))), url: `${S46}/discography/${code}?ima=0000` });
      });
      if (!items.length) throw changed('discography items (li.box)', url);
      return items;
    })().catch(e => { discoCache = undefined; throw e; });
    return discoCache;
  }
  const list_discography = {
    description: 'All releases on the official DISCOGRAPHY page (singles, albums, DVD/Blu-ray; every edition is a separate item).',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    async run() { const items = await fetchDiscographyList(); return { total: items.length, items }; } };

  const get_discography = {
    description: 'One release from the official page (title, type, date, catalog/price text, other editions). Set include_sonymusic=true to also fetch Sony Music JSON (third-party: tracks per disc, price, bonuses). Code like "SRCL-13890".',
    inputSchema: { type: 'object', additionalProperties: false, required: ['code'], properties: { code: { type: 'string', pattern: '^[A-Z]{2,6}-\\d+$' },
      include_sonymusic: { type: 'boolean', default: false, description: 'Opt-in third-party call to sonymusic.co.jp for track list, price and bonuses. Off by default.' } } },
    async run(a) {
      const code = String(a.code || '').toUpperCase();
      if (!/^[A-Z]{2,6}-\d+$/.test(code)) throw new Error('code must look like SRCL-13890');
      const url = `${S46}/discography/${code}?ima=0000`;
      const html = await politeFetch(url, 'text');
      const di = html.indexOf('com-discodetail-part');
      if (di < 0) throw changed('release detail block (com-discodetail-part)', url);
      const head = html.slice(di, html.indexOf('disco-products', di) > 0 ? html.indexOf('disco-products', di) : di + 6000);
      const title = text(first(/<h3 class="title">([\s\S]*?)<\/h3>/, head) || '');
      if (!title) throw changed('release title', url);
      const dates = [...head.matchAll(/<p class="date[^"]*">([\s\S]*?)<\/p>/g)].map(m => text(m[1]));
      const pi = html.indexOf('disco-products');
      const editions = pi < 0 ? [] : [...html.slice(pi).matchAll(/<li class="box[^"]*">\s*<a href="[^"]*\/discography\/([A-Z0-9-]+)[^"]*">([\s\S]*?)<\/a>/g)].map(([, c, inner]) => clean({
        code: c, title: text(first(/<h3 class="title">([\s\S]*?)<\/h3>/, inner) || ''), release_date: dotDate(text(first(/<p class="date[^"]*">([\s\S]*?)<\/p>/, inner) || '')),
        jacket: cleanImageUrl(abs(bgUrl(inner))), url: `${S46}/discography/${c}?ima=0000` }));
      const out = clean({ code, url, title, type: text(first(/<p class="type">([\s\S]*?)<\/p>/, head) || ''), nth: text(first(/<p class="nth">([\s\S]*?)<\/p>/, head) || ''),
        release_date: dotDate(dates[0]), catalog_price_text: dates[1], jacket: cleanImageUrl(abs(bgUrl(head))),
        other_editions: nonEmpty(editions.filter(e => e.code !== code)) });
      // Third-party: Sony Music JSONP (same call the official page makes)
      const smUrl = `https://www.sonymusic.co.jp/json/v2/artist/sakurazaka46/discography/${code}`;
      if (a.include_sonymusic !== true) { out.sonymusic = null; return out; } // third-party call is opt-in
      try {
        const sm = await politeFetch(smUrl, 'jsonp');
        const it = sm && sm.items;
        if (!it || typeof it !== 'object') throw new Error('no items');
        out.sonymusic = clean({ source_url: smUrl, title: it.title, type: it.type, release_date: dotDate(it.release_date),
          catalog_numbers: it.display_goods_number, price: it.price ? Number(it.price) : undefined, price_extax: it.price_extax ? Number(it.price_extax) : undefined,
          catch_copy: it.catch_copy, privileges: nonEmpty((it.privileges || []).map(p => typeof p === 'string' ? decode(p).trim() : p).filter(Boolean)),
          shop_url: it.ec_link,
          discs: groupDiscs(it.discs) });
      } catch (e) { out.sonymusic_error = `Sony Music data unavailable: ${e.message}`; }
      return out;
    } };

  return { _parseSessions: parseSessions, get_meet_greet_event, get_schedule, get_formation, get_blog_post, list_discography, get_discography };
};
