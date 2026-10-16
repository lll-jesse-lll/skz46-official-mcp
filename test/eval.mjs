// Offline eval of the ask router's parser (no network). Usage: node test/eval.mjs
import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);
const { parse, liveType, parseVenue } = require('../server/router.js'); const E = require('./eval-queries.json');
const sub = (exp, got) => Object.entries(exp).every(([k, v]) => typeof v === 'object' && v ? got && sub(v, got[k]) : got && got[k] === v);
let ok = 0, iOk = 0; const rows = [];
for (const c of E.queries) {
  const r = parse(c.q, { now: E.now });
  const intentOk = r.intent === c.intent; const ambOk = !!r.ambiguous === !!c.ambiguous; const pOk = !c.params || sub(c.params, r.params);
  const pass = intentOk && ambOk && pOk; ok += pass; iOk += intentOk;
  rows.push(`| ${c.q} | ${c.intent} | ${r.intent}${r.ambiguous ? ' (ambiguous)' : ''} | ${JSON.stringify(r.params)} | ${r.confidence} | ${pass ? 'PASS' : 'FAIL'} |`);
}
console.log('| query | expected | got | params | conf | result |\n|---|---|---|---|---|---|\n' + rows.join('\n'));
console.log(`\nintent accuracy ${iOk}/${E.queries.length}; full (intent+params+ambiguity) ${ok}/${E.queries.length}`);
let lt = 0; for (const [t, exp] of E.live_type_cases) { const g = liveType({ title: t }); lt += g === exp; if (g !== exp) console.log('live_type FAIL', t, g); }
let vc = 0; for (const [t, v, c] of E.venue_cases) { const g = parseVenue(t) || {}; vc += g.venue === v && g.city === c; if (!(g.venue === v && g.city === c)) console.log('venue FAIL', t, g); }
console.log(`venue parse ${vc}/${E.venue_cases.length}`);
console.log(`live_type heuristic ${lt}/${E.live_type_cases.length}`);
process.exit(ok === E.queries.length && lt === E.live_type_cases.length && vc === E.venue_cases.length ? 0 : 1);
