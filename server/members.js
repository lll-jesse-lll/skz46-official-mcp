'use strict';
// Static member table (current roster) + name/alias resolver. No network.
const DATA = require('./members.json');
const kataToHira = s => s.replace(/[\u30a1-\u30f6]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
// Kanji variant / itaiji / simplified->traditional folding, applied to both query and roster.
const VARIANTS = { '嶋': '島', '嶌': '島', '岛': '島', '嵜': '崎', '﨑': '崎', '邊': '辺', '邉': '辺', '边': '辺', '齋': '斎', '齊': '斎', '斉': '斎', '髙': '高', '澤': '沢', '泽': '沢',
  '濱': '浜', '濵': '浜', '滨': '浜', '櫻': '桜', '樱': '桜', '廣': '広', '广': '広', '國': '国', '團': '団', '藤': '藤', '惠': '恵', '冨': '富', '眞': '真', '德': '徳', '桒': '桑',
  '﨑': '崎', '凜': '凛', '莉': '莉', '瀨': '瀬', '濑': '瀬', '縣': '県', '県': '県', '鈴': '鈴', '铃': '鈴', '纪': '紀', '紗': '紗', '纱': '紗', '优': '優', '爱': '愛', '谷': '谷',
  '遠': '遠', '远': '遠', '实': '実', '實': '実', '绫': '綾', '乡': '郷', '鄉': '郷', '叶': '葉', '叶': '葉', '东': '東', '泷': '滝', '瀧': '滝', '龍': '竜', '龙': '竜', '风': '風', '凪': '凪', '梦': '夢', '樂': '楽', '乐': '楽', '琳': '琳', '静': '静', '靜': '静', '诗': '詩', '贵': '貴', '兰': '蘭', '娅': '亜', '亞': '亜', '织': '織', '礼': '礼', '禮': '礼', '阳': '陽', '艺': '芸', '藝': '芸', '杨': '楊', '仓': '倉', '泽': '沢' };
const foldKanji = s => s.replace(/./gu, c => VARIANTS[c] || c);
const norm = s => foldKanji(kataToHira(String(s || '').normalize('NFKC').toLowerCase())).replace(/[\s・·\-_.]/g, '');

function keysFor(m) {
  const [given, family] = m.romaji.toLowerCase().split(/\s+/);
  const [kFam, kGiv] = m.kana.split(/\s+/);
  const [nFam, nGiv] = m.name.split(/\s+/);
  const full = [m.name, m.name_compact, m.kana, m.romaji, `${family} ${given}`, ...m.aliases.map(a => a.alias)];
  const partial = [nGiv, kGiv, given].filter(Boolean); // given name alone (may be ambiguous)
  const family_ = [nFam, kFam, family].filter(Boolean);
  return { full: [...new Set(full.map(norm))], given: [...new Set(partial.map(norm))], family: [...new Set(family_.map(norm))] };
}
const TABLE = DATA.members.map(m => ({ m, k: keysFor(m) }));
const pub = m => ({ member_id: m.member_id, name: m.name, kana: m.kana, romaji: m.romaji, generation: m.generation, aliases: m.aliases.length ? m.aliases : null });

function resolve(query) {
  const q = norm(query); if (!q) return [];
  if (/^\d+$/.test(q)) { const hit = TABLE.find(t => t.m.member_id === q); return hit ? [{ ...pub(hit.m), match: 'member_id' }] : []; }
  const out = [];
  for (const { m, k } of TABLE) {
    let match;
    if (k.full.includes(q)) match = 'exact';
    else if (k.given.includes(q)) match = 'given_name';
    else if (k.family.includes(q)) match = 'family_name';
    else if (q.length >= 2 && k.full.some(x => x.includes(q))) match = 'partial';
    if (match) out.push({ ...pub(m), match });
  }
  const rank = { exact: 0, given_name: 1, family_name: 2, partial: 3 };
  out.sort((a, b) => rank[a.match] - rank[b.match]);
  const best = out[0] && out[0].match; return out.filter(x => x.match === best); // keep only the strongest tier
}
// For member-taking tools: returns a member_id or throws a clear error (no guessing on ambiguity).
function memberIdFrom(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (/^\d+$/.test(String(value))) return String(value); // ids pass through (graduated members' ids too)
  const r = resolve(value);
  if (!r.length) throw new Error(`no current member matches "${value}" (try resolve_member; graduated members need a numeric member_id)`);
  if (r.length > 1) throw new Error(`"${value}" is ambiguous: ${r.map(x => `${x.name} (${x.member_id})`).join(', ')}`);
  return r[0].member_id;
}

const resolve_member = {
  description: 'Resolve a member name, kana, romaji or alias (incl. zh-Hant/zh-Hans spellings, given or family name) to member_id. Current roster only. Use before tools that take member_id, or pass the name directly to them.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {
    query: { type: 'string', minLength: 1, description: 'e.g. "森田ひかる", "ひかる", "Hikaru Morita", "山崎天", "谷口爱季", or "all" to list every member.' } }, required: ['query'] },
  async run(a) {
    if (String(a.query).trim().toLowerCase() === 'all') return { total: TABLE.length, items: TABLE.map(t => pub(t.m)), source: DATA.source, fetched: DATA.fetched };
    const items = resolve(a.query);
    return { query: a.query, total: items.length, items, source: DATA.source, fetched: DATA.fetched };
  } };

// Find members mentioned inside free text (full names/aliases; given names >=2 chars). Used by the ask router.
function findInText(text) {
  const q = norm(text); const hits = [];
  for (const { m, k } of TABLE) {
    const full = k.full.filter(x => x.length >= 2 && q.includes(x)).sort((a, b) => b.length - a.length)[0];
    const giv = !full && k.given.filter(x => x.length >= 2 && q.includes(x)).sort((a, b) => b.length - a.length)[0];
    if (full || giv) hits.push({ ...pub(m), match: full ? 'full' : 'given_name', matched: full || giv, len: (full || giv).length });
  }
  if (hits.some(h => h.match === 'full')) return hits.filter(h => h.match === 'full');
  if (hits.length) return hits;
  for (const { m, k } of TABLE) { const f = k.family.filter(x => x.length >= 2 && q.includes(x))[0]; if (f) hits.push({ ...pub(m), match: 'family_name', matched: f, len: f.length }); }
  return hits;
}
module.exports = { findInText, norm, resolve, memberIdFrom, resolve_member, MEMBERS: DATA.members };
