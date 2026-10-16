'use strict';
// ask router: deterministic zh/ja fan-phrase parser -> intent + params, then runs internal tools. No LLM, no guessing:
// when the intent or member is ambiguous it returns candidates instead of calling anything.
const { findInText, norm } = require('./members.js');

const CN = { 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const cnNum = s => { if (/^\d+$/.test(s)) return Number(s); if (s.length === 1) return CN[s];
  if (s[0] === '十') return 10 + (CN[s[1]] || 0); return CN[s[0]] * 10 + (s[1] === '十' ? (CN[s[2]] || 0) : 0); };
const NUM = '(\\d{1,2}|[一二两兩三四五六七八九十]{1,3})';

// Intent rules, checked in order of specificity. Each: [intent, regex].
const RULES = [
  ['store_stock', /(還有貨|还有货|有貨|有货|有沒有貨|有没有货|庫存|库存|在庫|売り?切|賣完|卖完|缺貨|缺货|補貨|补货|sold\s*out|in\s*stock|stock)/i],
  ['music_tv', /(音番|音楽番組|音樂節目|音乐节目|歌番|音樂番組|music\s*tv)/i],
  ['meet_greet', /(見面會|见面会|見面会|握手|ミーグリ|ミート[&＆]グリート|meet\s*[&＆]?\s*greet|個別|个别|サイン会|簽名會|签名会|オンライン.*お話し会|お話し会)/i],
  ['center', /(c位|Ｃ位|センター|center|中心位|C位)/i],
  ['formation', /(站位|選拔|选拔|フォーメーション|formation|陣型|阵型|隊形|队形|列|福神)/i],
  ['blog', /(blog|ブログ|部落格|博客|日記|日记)/i],
  ['greeting', /(問候卡|问候卡|グリーティング|greeting|賀卡|贺卡)/i],
  ['discography', /(專輯|专辑|アルバム|album|ディスコ|discography|曲目|收錄|收录|收録|特典|発売日|發售|发售|tracklist|ジャケ)/i],
  ['store', /(周邊|周边|グッズ|goods|商品|ストア|store|官方商店|買|购买|購買|通販)/i],
  ['news', /(新聞|新闻|ニュース|news|消息|公告|お知らせ|情報解禁|官宣)/i],
  ['special', /(演唱會|演唱会|ライブ|live|巡演|ツアー|tour|公演|special|特設|backs\s*live|周年)/i],
  ['schedule', /(行程|スケジュール|schedule|日程|出演|上節目|上节目|電視|电视|テレビ|tv|廣播|广播|ラジオ|radio|雜誌|杂志|雑誌|magazine|配信|活動|活动|予定|安排)/i],
  ['member', /(誰是|谁是|プロフィール|profile|成員|成员|メンバー|member|幾期|几期|期生)/i],
];
const SCHEDULE_LABEL = [[/(廣播|广播|ラジオ|radio)/i, 'ラジオ'], [/(雜誌|杂志|雑誌|magazine)/i, '雑誌'], [/(電視|电视|テレビ|\btv\b)/i, 'テレビ'], [/配信/, '配信']];

// Heuristic live classification (marked live_type_source: 'heuristic'): festival = multi-artist events; solo = Sakurazaka46's own lives.
const FEST_NAME = /(gigantic|rock\s*in\s*japan|countdown\s*japan|\bcdj\b|\btif\b|tokyo\s*idol\s*festival|アラバキ|arabaki|summer\s*sonic|サマソニ|a-nation|japan\s*jam|metrock|イナズマロック|rush\s*ball|@jam|超パーティー)/i; // explicit multi-artist festival names
const STRONG_SOLO = /(感謝祭|buddies|櫻坂46\s*\S*\s*[「『]|backs\s*live|anniversary|期生\s*live|期生ライブ|ワンマン|単独)/i;
const FEST_GENERIC = /(フェス|festival|\bfes\b|音楽祭|対バン|コラボライブ)/i; // no bare 祭
const SOLO_RE = /(arena\s*tour|tour\s*20|ツアー|showcase|新参者)/i;
function liveType(x) { const t = `${x.title || ''} ${x.description || ''}`;
  if (FEST_NAME.test(t)) return 'festival'; if (STRONG_SOLO.test(t)) return 'solo'; if (FEST_GENERIC.test(t)) return 'festival'; if (SOLO_RE.test(t)) return 'solo'; return 'unknown'; }
const FEST_Q = /(音樂節|音乐节|音樂祭|音乐祭|フェス|festival|\bfes\b|fes(?=\s|$)|gigantic|rock\s*in\s*japan|countdown\s*japan|\bcdj\b|\btif\b|アラバキ|arabaki|summer\s*sonic|サマソニ|japan\s*jam|對拼|对拼|拼盤|拼盘)/i;
// Venue -> city/prefecture (static, server/venues.json). Longest alias first.
const VENUES = require('./venues.json').venues.map(([name, city, pref, al]) => ({ name, city, prefecture: pref, keys: [name, ...al].map(k => norm(k)).sort((a, b) => b.length - a.length) }));
function findVenue(text) { const t = norm(text); let best = null;
  for (const v of VENUES) for (const k of v.keys) if (k.length >= 2 && t.includes(k) && (!best || k.length > best.len)) best = { v, len: k.length };
  return best ? { venue: best.v.name, city: best.v.city, prefecture: best.v.prefecture } : null; }
// Venue line from schedule description (【会場】) or special-page text (### 会場 / 会場・日程).
function parseVenue(text) { if (!text) return null;
  const m = /(?:【会場】|###\s*会場(?:・日程)?)\s*\n+\s*([^\n]+)/.exec(text);
  const raw = m ? m[1].trim() : null; const known = findVenue(raw || '') || (raw ? null : null);
  if (raw) return { venue: known ? known.venue : raw, venue_raw: raw, city: known ? known.city : null, prefecture: known ? known.prefecture : null };
  return null; }
// Tour descriptions list legs: 《愛知》ポートメッセなごや ... 4月26日(土) ...; pick the leg whose dates include the item's date.
function legVenue(desc, date) { if (!desc || !date) return null; const [, mm, dd] = date.split('-').map(Number);
  const parts = desc.split(/《([^》]+)》/); // [pre, label, body, label, body...]
  for (let i = 1; i < parts.length; i += 2) { const body = parts[i + 1] || ''; const venueLine = body.trim().split('\n')[0].trim();
    const dates = [...body.matchAll(/(\d{1,2})月(\d{1,2})日/g)].map(m => [+m[1], +m[2]]);
    if (dates.some(([m, d]) => m === mm && d === dd)) { const k = findVenue(venueLine);
      return { venue: k ? k.venue : venueLine, venue_raw: venueLine, city: k ? k.city : parts[i], prefecture: k ? k.prefecture : null }; } }
  return null; }
const HISTORY_START = '2020-10'; // group renamed to 櫻坂46 in Oct 2020: oldest schedule month walked by past fallbacks
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const jstToday = now => { const d = new Date(now.getTime() + 9 * 3600e3); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); };
const addDays = (d, n) => new Date(d.getTime() + n * 86400e3);
const monthRange = (y, m) => ({ from: `${y}-${pad(m)}-01`, to: ymd(new Date(Date.UTC(y, m, 0))) });

// Relative/absolute dates in JST -> {from, to, label}
function parseDates(q, now) {
  const t = jstToday(now); const y = t.getUTCFullYear(), mo = t.getUTCMonth() + 1;
  const dow = (t.getUTCDay() + 6) % 7; const monday = addDays(t, -dow);
  const day = (d, label) => ({ from: ymd(d), to: ymd(d), label });
  const week = (off, label) => ({ from: ymd(addDays(monday, 7 * off)), to: ymd(addDays(monday, 7 * off + 6)), label });
  let m;
  if ((m = /(\d{4})\s*[-\/年]\s*(\d{1,2})\s*[-\/月]\s*(\d{1,2})/.exec(q))) return day(new Date(Date.UTC(+m[1], m[2] - 1, +m[3])), 'explicit_date');
  if ((m = /(?<![\d\/])(\d{1,2})\s*[\/月]\s*(\d{1,2})\s*[日号號]?(?![\d部])/.exec(q)) && !/月\s*\d+\s*部/.test(m[0])) return day(new Date(Date.UTC(y, m[1] - 1, +m[2])), 'explicit_date');
  if ((m = /(\d{4})\s*[-\/年]\s*(\d{1,2})\s*月?/.exec(q))) return { ...monthRange(+m[1], +m[2]), label: 'explicit_month' };
  if (/(今天|今日|きょう|today)/i.test(q)) return day(t, 'today');
  if (/(明天|明日|あした|tomorrow)/i.test(q)) return day(addDays(t, 1), 'tomorrow');
  if (/(後天|后天|明後日)/.test(q)) return day(addDays(t, 2), 'day_after_tomorrow');
  if (/(昨天|昨日|yesterday)/i.test(q)) return day(addDays(t, -1), 'yesterday');
  if (/(下週|下周|下星期|下禮拜|下礼拜|来週|來週|next\s*week)/i.test(q)) return week(1, 'next_week');
  if (/(上週|上周|上星期|先週|last\s*week)/i.test(q)) return week(-1, 'last_week');
  if (/(這週|这周|這周|本週|本周|今週|這星期|这星期|這禮拜|this\s*week)/i.test(q)) return week(0, 'this_week');
  if (/(週末|周末|weekend)/i.test(q)) return { from: ymd(addDays(monday, 5)), to: ymd(addDays(monday, 6)), label: 'this_weekend' };
  if (/(下個月|下个月|来月|來月|next\s*month)/i.test(q)) return { ...monthRange(mo === 12 ? y + 1 : y, mo === 12 ? 1 : mo + 1), label: 'next_month' };
  if (/(上個月|上个月|先月|last\s*month)/i.test(q)) return { ...monthRange(mo === 1 ? y - 1 : y, mo === 1 ? 12 : mo - 1), label: 'last_month' };
  if (/(這個月|这个月|本月|今月|this\s*month)/i.test(q)) return { ...monthRange(y, mo), label: 'this_month' };
  if ((m = /(?<![\d第])(\d{1,2}|十[一二]?|[一二三四五六七八九])\s*月(?!\s*\d+\s*日)/.exec(q))) { const n = cnNum(m[1]); if (n >= 1 && n <= 12) return { ...monthRange(y, n), label: 'month_in_current_year' }; }
  return null;
}
function parseSingle(q) {
  let m;
  if ((m = new RegExp(NUM + '\\s*(?:單|单|枚目|th\\s*single|st\\s*single|nd\\s*single|rd\\s*single|thシングル|stシングル|ndシングル|rdシングル|(?:th|st|nd|rd)?\\s*シングル)', 'i').exec(q))) return cnNum(m[1]);
  if ((m = new RegExp('第\\s*' + NUM + '\\s*(?:張|张|枚|首)?\\s*(?:單曲|单曲|シングル|single)', 'i').exec(q))) return cnNum(m[1]);
  if ((m = /single\s*#?\s*(\d{1,2})/i.exec(q))) return +m[1];
  return undefined;
}
function parsePart(q) { const m = new RegExp('第\\s*' + NUM + '\\s*(?:部|場|场)|part\\s*(\\d+)|' + NUM + '\\s*部', 'i').exec(q); return m ? cnNum(m[1] || m[2] || m[3]) : undefined; }
// Japanese cities / prefectures commonly used for meet&greet venues, with zh spellings.
const CITIES = [['京都', ['京都', 'kyoto']], ['東京', ['東京', '东京', 'tokyo']], ['大阪', ['大阪', 'osaka']], ['名古屋', ['名古屋', 'nagoya', '愛知', '爱知']], ['福岡', ['福岡', '福冈', 'fukuoka']],
  ['横浜', ['横浜', '橫濱', '横滨', 'yokohama', '神奈川']], ['幕張', ['幕張', '幕张', 'makuhari', '千葉', '千叶']], ['埼玉', ['埼玉', 'saitama']], ['札幌', ['札幌', 'sapporo', '北海道']],
  ['仙台', ['仙台', 'sendai']], ['広島', ['広島', '廣島', '广岛', 'hiroshima']], ['神戸', ['神戸', '神戶', 'kobe']], ['オンライン', ['オンライン', '線上', '线上', 'online', '網路', '网络']]];
const parseCity = q => { const l = q.toLowerCase(); for (const [c, ks] of CITIES) if (ks.some(k => l.includes(k.toLowerCase()))) return c; };

const STOP = /(還有貨|还有货|有貨|有货|有沒有貨|有没有货|嗎|吗|呢|\?|？|庫存|库存|在庫|周邊|周边|グッズ|官方|商店|的|是否|還|还|請問|请问|あります|か|は|ありますか|売り?切れ?|賣完了?|卖完了?|缺貨|缺货|stock|in|goods|store|搜尋|搜索|找|查)/gi;
const keywordFrom = q => q.replace(STOP, ' ').replace(/\s+/g, ' ').trim();

function parse(query, opts = {}) {
  const q = String(query || '').normalize('NFKC').trim();
  const now = opts.now ? new Date(opts.now) : new Date();
  const notes = [];
  const matched = RULES.filter(([, re]) => re.test(q)).map(([i]) => i);
  let members = findInText(q);
  const single = parseSingle(q); const part = parsePart(q); const qVenue = findVenue(q); const city = parseCity(q) || (qVenue && qVenue.city);
  let range = opts.date_range && opts.date_range.from ? { from: opts.date_range.from, to: opts.date_range.to || opts.date_range.from, label: 'date_range_param' } : parseDates(q, now);
  let intent = matched[0];
  // contextual refinements
  if (intent === 'center' || (matched.includes('formation') && intent !== 'store_stock')) intent = matched.includes('center') ? 'center' : 'formation';
  if (!intent && single) intent = 'formation';
  if (!intent && members.length === 1) intent = 'blog'; // a bare member name: most common ask is the latest blog
  if (intent === 'store' && matched.includes('news')) intent = 'news';
  if (intent === 'special' && !city && !/(演唱會|演唱会|ライブ|live|巡演|ツアー|tour|公演)/i.test(q) && (range || matched.includes('schedule'))) intent = 'schedule';
  if (qVenue && (!intent || ['special', 'schedule'].includes(intent))) intent = 'special';
  if (intent === 'special' && (qVenue || /(演唱會|演唱会|ライブ|live|巡演|ツアー|tour|公演)/i.test(q))) intent = 'live';
  if (FEST_Q.test(q) && (!intent || ['special', 'schedule', 'news', 'live'].includes(intent))) intent = 'live';
  const memberAmbiguous = members.length > 1 && !['store', 'store_stock', 'news', 'discography'].includes(intent);
  const params = {};
  let confidence = matched.length ? 'high' : (intent ? 'medium' : 'low');
  if (matched.length > 2) confidence = 'medium';
  const member = members.length === 1 ? members[0] : undefined;
  const sched = r => { if (!r) return {}; return r.from === r.to ? { date: r.from } : { date_range: { from: r.from, to: r.to } }; };
  switch (intent) {
    case 'music_tv': Object.assign(params, { genre: 'music_tv' }, sched(range)); if (member) params.member = member.member_id; break;
    case 'schedule': { Object.assign(params, sched(range)); for (const [re, l] of SCHEDULE_LABEL) if (re.test(q)) { params.label = l; break; }
      if (member) params.member = member.member_id; if (!range) notes.push('no date given: using the current month'); break; }
    case 'meet_greet': if (single) params.single = single; if (city) params.city = city; if (part) params.part = part; if (range) params.date_range = { from: range.from, to: range.to };
      if (member) params.member = member.member_id; break;
    case 'center': case 'formation': if (single) params.single = single; else notes.push('no single number given: latest single');
      if (intent === 'center') params.want = 'center'; break;
    case 'blog': if (member) params.member_id = member.member_id; break;
    case 'greeting': if (member) params.member_id = member.member_id; break;
    case 'news': if (range) params.dy = range.from.slice(0, 7).replace('-', ''); { const k = /(グッズ|周邊|周边|goods)/i.test(q) ? 'goods' : /(發售|发售|リリース|release|発売)/i.test(q) ? 'release' : /(活動|活动|イベント|event)/i.test(q) ? 'event' : /(門票|门票|チケット|ticket)/i.test(q) ? 'ticket' : undefined; if (k) params.category = k; } break;
    case 'discography': if (single) params.single = single; break;
    case 'store': case 'store_stock': { const kw = keywordFrom(q); if (kw) params.keyword = kw; else notes.push('no product words found'); break; }
    case 'special': break;
    case 'live': params.live_type = FEST_Q.test(q) ? 'festival' : 'solo'; if (qVenue) params.venue = qVenue.venue; if (city && city !== 'オンライン') params.city = city; if (range) params.date_range = { from: range.from, to: range.to }; break;
    case 'member': if (member) params.member_id = member.member_id; break;
  }
  // Time direction for event-like intents: upcoming by default; past only on explicit signals.
  if (['meet_greet', 'schedule', 'music_tv', 'live'].includes(intent)) {
    const today = ymd(jstToday(now));
    const pastWord = /(上次|上一次|之前|以前|去年|過去|过去|已經|已经|前回|昨年|この前|last\s*time|previous|past)/i.test(q);
    const pastDate = range && range.to < today;
    params.when = pastWord || pastDate || (intent === 'meet_greet' && single) ? 'past_allowed' : 'upcoming';
    if (params.when === 'upcoming' && !['meet_greet', 'live'].includes(intent) && !range) { params.date_range = { from: today, to: ymd(addDays(jstToday(now), 30)) }; delete params.date; notes.splice(0, notes.length, 'no date given: upcoming 30 days (JST)'); }
    if (params.when === 'upcoming' && ['meet_greet', 'live'].includes(intent)) params.from = today;
  }
  const out = { intent: intent || null, params, confidence, matched_terms: matched, notes };
  if (members.length) out.members = members.map(m => ({ member_id: m.member_id, name: m.name, matched: m.matched }));
  if (range) out.dates = range;
  if (!intent) { out.ambiguous = true; out.candidates = ['schedule', 'news', 'blog', 'meet_greet', 'formation', 'store'].map(i => ({ intent: i })); out.confidence = 'low'; }
  if (memberAmbiguous) { out.ambiguous = true; out.confidence = 'low'; out.candidates = members.map(m => ({ intent, params: { ...params, member: m.member_id }, member: m.name })); }
  if (['blog', 'greeting'].includes(intent) && !member && !memberAmbiguous) notes.push('no member recognized: all members');
  return out;
}

module.exports = ({ tools }) => {
  const call = (name, args) => tools[name].run(args);
  const inRange = (d, r) => d && d >= r.from && d <= r.to;
  const monthsOf = r => { const out = []; let [y, m] = r.from.split('-').map(Number); const [ty, tm] = r.to.split('-').map(Number);
    while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${pad(m)}`); if (++m > 12) { m = 1; y++; } if (out.length > 3) break; } return out; };
  async function schedule(p) {
    const { date_range, when, ...rest } = p;
    if (!date_range) return call('get_schedule', rest);
    let items = [];
    for (const month of monthsOf(date_range)) items.push(...(await call('get_schedule', { ...rest, month })).items);
    items = items.filter(i => inRange(i.date, date_range));
    if (items.length || when !== 'upcoming') return { total: items.length, items, date_range };
    // nothing upcoming: walk back over all history (newest first), cap 10, labeled past
    const today = date_range.from; const past = []; const t = new Date(today + 'T00:00:00Z');
    for (let i = 0; past.length < 10; i++) { const month = ymd(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - i, 1))).slice(0, 7); if (month < HISTORY_START) break;
      const its = (await call('get_schedule', { ...rest, month })).items.filter(x => x.date < today).sort((a, b) => b.date.localeCompare(a.date));
      for (const x of its) if (past.length < 10) past.push({ ...x, is_past: true }); }
    return { total: 0, items: [], date_range, none_upcoming: true, past_fallback: past, note: 'No upcoming match (JST); past_fallback lists the most recent PAST matches (is_past: true), newest first.' };
  }
  async function meetGreet(p) {
    const list = await call('list_meet_greet_events', {});
    let ev = list.items;
    const kw = [];
    if (p.single) { const re = new RegExp(`(${p.single}(th|st|nd|rd)\\s*シングル|${p.single}枚目)`, 'i'); ev = ev.filter(e => re.test(e.title)); kw.push(`single ${p.single}`); }
    if (p.date_range) ev = ev.filter(e => inRange(e.date, p.date_range));
    const all = ev;
    if (p.when === 'upcoming') ev = ev.filter(e => e.date && e.date >= p.from);
    if (p.city && p.city !== 'オンライン') ev = ev.filter(e => !/オンライン/.test(e.title)); // city usually only on detail page
    if (p.city === 'オンライン') ev = ev.filter(e => /オンライン/.test(e.title + (e.category || '')));
    const pastHint = () => { const past = all.filter(e => e.date && e.date < p.from).sort((a, b) => b.date.localeCompare(a.date))[0];
      return past ? { latest_past_event: { code: past.code, title: past.title, date: past.date }, next_hint: { tool: 'get_meet_greet_event', params: { code: String(past.code) }, why: 'latest past event (not upcoming)' } } : {}; };
    if (p.when === 'upcoming' && !ev.length) return { events: [], matches: [], none_upcoming: true, note: 'No upcoming matching meet&greet event (JST). Past events are only returned when asked (e.g. 上次 / N單).', ...pastHint() };
    const cands = ev.slice(0, 3); // fetch at most 3 detail pages (>=1s each)
    const hits = [];
    for (const e of cands) {
      const d = await call('get_meet_greet_event', { code: e.code });
      let s = d.sessions || [];
      if (p.city && p.city !== 'オンライン') s = s.filter(x => (x.venue || x.venue_label || x.raw_text || x.section || '').includes(p.city) || norm(JSON.stringify(x)).includes(norm(p.city)));
      if (p.part) s = s.filter(x => x.part === p.part);
      if (p.when === 'upcoming') s = s.filter(x => !x.date || x.date >= p.from);
      const seen = new Set(hits.flatMap(h => h.sessions.map(x => x.date + x.raw_text + (x.venue || ''))));
      s = s.filter(x => !seen.has(x.date + x.raw_text + (x.venue || '')));
      if (s.length) hits.push({ code: e.code, title: d.title, url: d.url, sessions: s });
    }
    if (p.when === 'upcoming' && !hits.length) return { events_checked: cands.map(e => ({ code: e.code, title: e.title, date: e.date })), matches: [], none_upcoming: true, note: 'No upcoming session matches (JST).', ...pastHint() };
    return { events_checked: cands.map(e => ({ code: e.code, title: e.title, date: e.date })), matches: hits, total_matching_events: ev.length };
  }
  async function stock(p) {
    if (!p.keyword) return { note: 'no product keyword recognized', items: [] };
    const l = await call('list_store_products', { keyword: p.keyword });
    const items = l.items.slice(0, 10);
    if (items.length !== 1) return { products: items, total: l.total, note: items.length ? 'several products match: pick one and call get_store_product / check_store_stock' : 'no products found' };
    const prod = await call('get_store_product', { product_id: items[0].product_id });
    return { product: prod };
  }
  // Live/concerts: upcoming first (schedule label ライブ for the next 3 months + LIVE special pages); past only as labeled fallback.
  async function live(p) {
    const today = p.from || ymd(jstToday(new Date()));
    const keys = p.city ? (CITIES.find(c => c[0] === p.city) || [p.city, [p.city]])[1].map(k => k.toLowerCase()) : [];
    const cityOk = x => { if (p.venue) return x.venue === p.venue || norm(JSON.stringify(x)).includes(norm(p.venue));
      if (!p.city) return true; if (x.city) return x.city === p.city || keys.includes(x.city.toLowerCase()) || keys.some(k => (x.prefecture || '').startsWith(k));
      return (t => keys.some(k => t.includes(k)))(JSON.stringify(x).toLowerCase()); };
    const withVenue = x => { const v = legVenue(x.description, x.date) || parseVenue(x.description) || findVenue(`${x.title || ''} ${x.description || ''}`); return v ? { ...x, venue: v.venue, venue_raw: v.venue_raw || null, city: v.city, prefecture: v.prefecture } : { ...x, venue: null, city: null, prefecture: null }; };
    const pageVenue = async x => { try { const pg = await call('get_special_page', { slug: x.slug }); const v = parseVenue(pg.text); return v ? { ...x, venue: v.venue, venue_raw: v.venue_raw, city: v.city, prefecture: v.prefecture } : { ...x, venue: null, city: null, prefecture: null }; } catch { return { ...x, venue: null, city: null, prefecture: null }; } };
    const rng = p.date_range || { from: today, to: ymd(addDays(jstToday(new Date()), 92)) };
    let sched = [];
    for (const month of monthsOf(rng)) sched.push(...(await call('get_schedule', { month, label: 'ライブ' })).items);
    const want = p.live_type || 'solo';
    const typed = x => withVenue({ ...x, live_type: liveType(x), live_type_source: 'heuristic' });
    const allSched = sched.filter(i => inRange(i.date, rng) && cityOk(i)).map(typed);
    sched = allSched.filter(i => want === 'festival' ? i.live_type === 'festival' : i.live_type !== 'festival');
    let allPages = (await call('list_special_pages', {})).items.filter(x => x.source === 'live').map(x => ({ ...x, live_type: liveType(x), live_type_source: 'heuristic' }));
    // read venue from upcoming live pages (at most 4 page reads)
    { const up = allPages.filter(x => !x.date || x.date >= today).slice(0, 4); const done = new Map();
      for (const x of up) done.set(x.slug, await pageVenue(x));
      allPages = allPages.map(x => done.get(x.slug) || withVenue(x)); }
    const pages = allPages.filter(x => cityOk(x) && (want === 'festival' ? x.live_type === 'festival' : x.live_type !== 'festival'));
    const festHint = list => want === 'solo' && list.length ? { festival_hint: { note: 'Multi-artist festivals (not Sakurazaka46 solo lives); hint only, not the answer.', items: list.slice(0, 5) } } : {};
    const upPages = pages.filter(x => !x.date || x.date >= today);
    if (p.when === 'upcoming' && !sched.length && !upPages.length && p.city) {
      const other = allPages.filter(x => x.date && x.date >= today);
      if (other.length) p._other = other.slice(0, 5); }
    const upFest = allSched.filter(i => i.live_type === 'festival');
    if (p.when !== 'upcoming' || sched.length || upPages.length) return { live_type: want, schedule: sched, special_pages: (p.when === 'upcoming' ? upPages : pages).slice(0, 10), is_past: false, ...(sched.length || upPages.length ? {} : festHint(upFest)) };
    const past = pages.filter(x => x.date && x.date < today).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).map(x => ({ ...x, is_past: true }));
    let pastSched = [];
    { const t = jstToday(new Date()); 
      // Walk back month by month (newest first) over all available history, stop once 3 matching past shows are found.
      const shows = new Map(); var pastFest = []; const t0 = Date.now();
      for (let i = 0; shows.size < 3 && !(shows.size >= 1 && Date.now() - t0 > 50000); i++) { // soft budget: once >=1 found, stop after ~50s
        const month = ymd(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - i, 1))).slice(0, 7);
        if (month < HISTORY_START) break;
        let its; try { its = (await call('get_schedule', { month, label: 'ライブ' })).items; } catch { break; }
        for (const it of its.filter(i => i.date < today).map(typed).filter(cityOk).sort((a, b) => b.date.localeCompare(a.date))) {
          if (it.live_type === 'festival') { pastFest.push({ ...it, is_past: true }); if (want !== 'festival') continue; }
          else if (want === 'festival') continue;
          const key = `${it.title}|${it.venue || ''}`; const prev = shows.get(key);
          if (prev) { if (!prev.dates.includes(it.date)) prev.dates.push(it.date); }
          else if (shows.size < 3) shows.set(key, { ...it, description: undefined, dates: [it.date], is_past: true });
        }
      }
      pastSched = [...shows.values()].map(x => { const { description, ...rest } = x; return { ...rest, dates: x.dates.sort() }; }); }
    { pastSched = pastSched.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10).map(x => ({ ...x, is_past: true })); }
    const hint = festHint([...upFest, ...pastFest]);
    return { live_type: want, ...hint, other_upcoming_live_without_city_match: p._other ? p._other.filter(x => want === 'festival' ? x.live_type === 'festival' : x.live_type !== 'festival') : null, schedule: pastSched, special_pages: past, none_upcoming: true, is_past: past.length + pastSched.length > 0, note: `No upcoming live${p.city ? ' in ' + p.city : ''} found (schedule next 3 months + LIVE pages, JST).` + (past.length + pastSched.length ? ' Showing latest PAST matches (is_past: true).' : '') };
  }
  const run = {
    live,
    music_tv: schedule, schedule,
    meet_greet: meetGreet,
    formation: p => call('get_formation', p.single ? { single: p.single } : {}),
    center: async p => { const f = await call('get_formation', { ...(p.single ? { single: p.single } : {}), infer_center: true });
      return { centers: (f.songs || []).map(s => ({ song: s.title, center: s.center, center_source: s.center_source, center_confidence: s.center_confidence, center_evidence: s.center_evidence || null })),
        single_number: f.single_number, title: f.title, release_date: f.release_date, discography_codes: f.discography_codes || null, formation: f }; },
    blog: p => call('list_blog_posts', p.member_id ? { member_id: p.member_id } : {}).then(r => ({ total: r.total, items: r.items.slice(0, 10) })),
    greeting: p => call('list_greeting_cards', p.member_id ? { member_id: p.member_id } : {}),
    news: p => call('list_news', { ...p, include_content: false }).then(r => ({ total: r.total, items: r.items.slice(0, 20) })),
    discography: async p => { const l = await call('list_discography', {});
      if (!p.single) return { total: l.total, items: l.items.slice(0, 20) };
      const re = new RegExp(`^${p.single}(th|st|nd|rd)\\s*Single`, 'i');
      const items = l.items.filter(i => i.type && /single|シングル/i.test(i.type) && (re.test(i.title || '') || re.test(i.subtitle || '') || String(i.number) === String(p.single)));
      return { items: items.length ? items : l.items.filter(i => /single|シングル/i.test(i.type || '')).slice(0, 20), note: items.length ? null : 'could not match the single number by title; showing singles' }; },
    store: p => call('list_store_products', p.keyword ? { keyword: p.keyword } : {}).then(r => ({ total: r.total, items: r.items.slice(0, 20) })),
    store_stock: stock,
    special: () => call('list_special_pages', {}).then(r => ({ total: r.total, items: r.items.slice(0, 20) })),
    member: p => call('resolve_member', { query: p.member_id || 'all' }),
  };
  const ask = {
    description: 'START HERE. Answers a fan question in Chinese/Japanese/English in one call: parses terms (音番, 見面會/ミーグリ 第N部, ブログ/部落格, N單 C位/站位, 周邊/グッズ 有貨嗎, 行程/下週/下個月, 新聞), member names/nicknames and dates (JST), then calls the right tool(s). Returns interpreted_as + confidence; if ambiguous returns candidates and calls nothing. Not for: exact ids you already have (call the specific tool). e.g. "下週有什麼音番", "16單 C位是誰".',
    inputSchema: { type: 'object', additionalProperties: false, required: ['query'], properties: {
      query: { type: 'string', minLength: 1, description: 'The fan question as written, e.g. "京都見面會第3部幾點", "石森璃花 最新blog", "這週行程".' },
      date_range: { type: 'object', additionalProperties: false, properties: { from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } }, description: 'Optional explicit JST date range overriding dates in the query.' } } },
    async run(a) {
      const interp = parse(a.query, { date_range: a.date_range });
      const interpreted_as = { intent: interp.intent, params: interp.params, members: interp.members || null, dates: interp.dates || null, notes: interp.notes.length ? interp.notes : null };
      if (interp.ambiguous) return { interpreted_as, confidence: interp.confidence, ambiguous: true, candidates: interp.candidates, result: null,
        hint: 'Ask the user to clarify, or call ask again with a more specific query / call the specific tool.' };
      const result = await run[interp.intent](interp.params);
      return { interpreted_as, confidence: interp.confidence, ambiguous: false, result };
    } };
  return { ask };
};
module.exports.parse = parse; module.exports.findVenue = findVenue; module.exports.parseVenue = parseVenue; module.exports.liveType = liveType;
