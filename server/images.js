'use strict';
// Shared image filter. Rules came from auditing real pages (blog posts, special pages, event pages, discography):
//  - absolutize; prefer the largest srcset / data-src (lazy-load) over a placeholder src
//  - drop data:/non-http, 1x1 / display:none pixels, third-party hosts (tracking, ads, OneTrust, YouTube thumbs)
//  - drop known site-chrome paths and icon/logo/arrow/share-style file names
//  - strip the ?ima=0000 tracking param and dedupe
// Content images (/images/14/..., /files/14/diary/..., per-page /files/14/sakura/pages/... art) are kept.
const ORIGIN = 'https://sakurazaka46.com';
const ALLOWED_HOSTS = [/^(www\.)?sakurazaka46\.com$/i, /(^|\.)sonymusic\.co\.jp$/i];
const CHROME_PATHS = [/^\/files\/14\/s46\/img\//i, /^\/files\/14\/s46\/images\//i, /^\/files\/14\/common\//i, /^\/files\/14\/app\//i];
const CHROME_NAMES = /(^|[\/_.-])(icon|ico|arrow|logo|sprite|spacer|blank|space|loading|loader|placeholder|noimage|no_image|btn|button|share|sns|emoji|pixel|transparent|clear|dummy|close)([_.\-\d]|$)/i;

function decodeAttr(s) { return String(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim(); }

function normalizeImageUrl(u, base = ORIGIN) {
  if (!u) return undefined;
  u = decodeAttr(u).replace(/^['"]|['"]$/g, '');
  if (!u || /^data:/i.test(u) || /^(javascript|about|blob):/i.test(u)) return undefined;
  let url; try { url = new URL(u, base); } catch { return undefined; }
  if (!/^https?:$/.test(url.protocol)) return undefined;
  if (/sakurazaka46\.com$/i.test(url.hostname)) { url.protocol = 'https:'; url.searchParams.delete('ima'); }
  return url.toString().replace(/\?$/, '');
}

// Why a URL is not a content image (undefined = keep).
// Official goods store (EC-CUBE 2) and its image CDNs; only allowed when a caller opts in (store tools).
const STORE_HOSTS = [/^store\.plusmember\.jp$/i, /^storage-store\.plusmember\.jp$/i, /^image\.emtg\.jp$/i];
const STORE_CHROME = [/^\/sakurazaka46\/user_data\//i, /^\/user_data\//i, /\/img\/common\//i];
function rejectReason(u, { store = false } = {}) {
  let url; try { url = new URL(u); } catch { return 'invalid'; }
  const isStore = store && STORE_HOSTS.some(re => re.test(url.hostname));
  if (!isStore && !ALLOWED_HOSTS.some(re => re.test(url.hostname))) return 'third-party';
  if (isStore && STORE_CHROME.some(re => re.test(url.pathname))) return 'site-chrome';
  if (CHROME_PATHS.some(re => re.test(url.pathname))) return 'site-chrome';
  const name = url.pathname.split('/').pop();
  if (CHROME_NAMES.test(name)) return 'icon/logo/ui';
  if (/\.(svg|ico)$/i.test(name)) return 'icon/logo/ui';
  return undefined;
}

function largestFromSrcset(ss) {
  if (!ss) return undefined;
  let best, bw = -1;
  for (const part of decodeAttr(ss).split(',')) {
    const [u, d] = part.trim().split(/\s+/); if (!u) continue;
    const w = d ? parseFloat(d) * (/x$/i.test(d) ? 1000 : 1) : 0;
    if (w > bw) { bw = w; best = u; }
  }
  return best;
}
const attr = (tag, name) => { const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag); return m ? (m[2] ?? m[3]) : undefined; };

// Collect candidate image URLs (raw, before filtering) from an HTML fragment.
function rawImages(html, { backgrounds = false } = {}) {
  const out = [];
  for (const mt of String(html).matchAll(/<(?:img|source)\b[^>]*>/gi)) {
    const tag = mt[0];
    const w = attr(tag, 'width'), h = attr(tag, 'height'), style = attr(tag, 'style') || '';
    const pixel = (w === '1' || w === '0') && (h === '1' || h === '0') || /display\s*:\s*none/i.test(style);
    const u = largestFromSrcset(attr(tag, 'data-srcset')) || attr(tag, 'data-src') || attr(tag, 'data-original') || attr(tag, 'data-lazy-src') || largestFromSrcset(attr(tag, 'srcset')) || attr(tag, 'src');
    out.push({ u, pixel, at: mt.index });
  }
  if (backgrounds) for (const m of String(html).matchAll(/background(?:-image)?\s*:\s*url\(\s*([^)]+?)\s*\)/gi)) out.push({ u: m[1], at: m.index });
  return out.sort((a, b) => a.at - b.at); // document order
}

// Main entry: HTML fragment -> filtered, deduped absolute image URLs. stats lets callers audit drops.
function extractImages(html, opts = {}) {
  const stats = { candidates: 0, kept: 0, dropped: {} };
  const seen = new Set(); const kept = [];
  for (const { u, pixel } of rawImages(html, opts)) {
    stats.candidates++;
    const n = normalizeImageUrl(u, opts.base);
    const why = !u ? 'no-src' : /^\s*data:/i.test(u) ? 'data-uri' : !n ? 'invalid' : pixel ? 'tracking-pixel' : rejectReason(n, opts);
    if (why) { stats.dropped[why] = (stats.dropped[why] || 0) + 1; continue; }
    if (seen.has(n)) { stats.dropped.duplicate = (stats.dropped.duplicate || 0) + 1; continue; }
    seen.add(n); kept.push(n);
  }
  stats.kept = kept.length;
  if (opts.stats) Object.assign(opts.stats, stats);
  return kept;
}

// For single scalar fields (thumbnail, jacket, avatar...): normalized URL, or undefined if junk.
function cleanImageUrl(u, base, opts) { const n = normalizeImageUrl(u, base); return n && !rejectReason(n, opts) ? n : undefined; }

module.exports = { extractImages, cleanImageUrl, normalizeImageUrl, rejectReason, rawImages };
