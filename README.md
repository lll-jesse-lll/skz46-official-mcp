# skz46-official (v0.4.1)

Agent Plugin (Agent Plugins 1.0.0 format) that wraps the **public, no-login** JSON endpoints of https://sakurazaka46.com in a zero-dependency stdio MCP server (Node ≥ 18, uses the built-in `fetch`).

## Data shapes
```ts
type OfficialPost = {
  kind: 'news' | 'blog';
  id: string;              // news: code (e.g. "R00638"); blog: article id ("71404")
  title: string;
  url: string;             // absolute
  published_at: string;    // ISO 8601 in JST, e.g. "2026-10-15T21:00:00+09:00"
  member_id?: string;      // blog only
  member_name?: string;    // blog only (upstream "creator")
  // news only (v0.4.0, upstream fields kept for hub use):
  pubdate?: string;        // official raw string, e.g. "2026/10/15 21:00:00" (JST), alongside ISO published_at
  category?: string;       // upstream code: release|goods|event|media|ticket|audition|shakehands|other
  category_label?: string | null; // label as printed on /s/s46/news/list (リリース, グッズ, イベント, メディア, チケット, オーディション, ミート＆グリート, その他, ファンクラブ)
  caption?: string | null;
  tags?: string[] | null;  // upstream member-id tags (only some items have them; others are null)
  content?: string | null; // article HTML; included by default, include_content:false omits it
  thumbnail?: string | null; // absolute URL
};
type MeetGreetEvent = { code: string; date: string /* YYYY-MM-DD */; title: string;
  category: string /* catename, e.g. オンライン */; category_code?: string /* catecode, e.g. online */;
  url: string; image?: string };
type GreetingCard = { member_id: string; name: string; name_kana: string;
  avatar?: string; card?: string; cheki?: string };
```
**v0.2.0 (scraped from server-rendered HTML; no JSON API exists for these):**
```ts
type ScheduleEvent = { date: string /* YYYY-MM-DD */; start_time?: string /* "23:15"; may exceed 24:00 e.g. "25:56" (JP broadcast style) */;
  end_time?: string; title: string; category: string /* media|event|release|shakehands|birthday (observed) */;
  category_label?: string /* テレビ, ラジオ, … */; members?: { member_id?: string; name: string }[] /* group-wide entries have no member_id */;
  description?: string /* plain text */; links?: string[]; url: string /* SCHEDULE page for that day */ };
type FormationMember = { member_id: string; name: string };
type Formation = { kind: 'single'|'album'; single_number?: number; album_number?: number; title: string; release_date: string;
  discography_code?: string; discography_codes?: string[]; // resolved from the official discography list (type + release date + title), NOT the formation page jacket links
  note?: string; // set when the page jacket links disagreed (e.g. 16th single links to 15th-single codes)
  rows: { front?: FormationMember[]; second?: FormationMember[]; third?: FormationMember[] };   // = songs[0].rows (title track)
  songs?: { title: string; song_titles?: string[] /* when one formation covers several songs */; rows: Formation['rows'] /* front|second|third|fourth */;
    center?: { member_id?: string; name: string }; center_source?: 'official' | 'front_row_middle'; center_confidence?: 'high' | 'medium';
    center_evidence?: { url: string; quote: string }; center_note?: string }[] };
// FormationMember.member_id is omitted for graduated members (no profile link).
type BlogPost = { id: string; title: string; member_id?: string; member_name?: string; published_at: string /* ISO +09:00 */;
  url: string; body_text: string /* tags stripped, line breaks kept */; images?: string[] /* absolute */ };
type DiscographyItem = { code: string; title: string; type: string /* SINGLE|ALBUM|… */; release_date?: string; price_text?: string; jacket?: string; url: string };
type DiscographyDetail = { code: string; url: string; title: string; type?: string; nth?: string; release_date?: string;
  catalog_price_text?: string; jacket?: string; other_editions?: DiscographyItem[];
  sonymusic?: { source_url: string; title?: string; type?: string; release_date?: string; catalog_numbers?: string;
    price?: number /* tax incl. */; price_extax?: number; catch_copy?: string; privileges?: string[]; shop_url?: string;
    discs?: { disc_number: number; title?: string; tracks: { track_number: number; title: string }[] }[] };
  sonymusic_error?: string };
```

The list tools return `{ total, offset?, items }`. `total` is the upstream `count` for news and blog, and `items.length` for the other two tools.

Normalization:
- Relative paths are turned into `https://sakurazaka46.com/...`.
- The body is parsed as JSON even when the content-type says `text/html`.
- `pubdate` (`YYYY/MM/DD HH:MM:SS`, JST) is converted to ISO with `+09:00`.
- Empty fields are omitted.

### MeetGreetDetail (`get_meet_greet_event`)
`{ code, title, url, category?, listed_date?, sessions?: MeetGreetSession[], members?: string[], body_text }`

`MeetGreetSession = { date?, section?, venue_label?, city?, venue?, part, start_time?, end_time?, reception_start?, reception_end?, raw_text }`.
These are parsed from the page text: `●/■ XX会場` blocks, `開催日:`/`会場:` lines, `【日程】` shared date lists (expanded per date), `第N部（HH:MM〜HH:MM）` and `＜第N部＞ 受付開始 … / イベント開始 … / 受付終了 … （HH:MM 終了予定）`.
Full-width digits and colons are normalized, and times past 24:00 are kept as written. `members` comes from `【レーン詳細】`/`【参加メンバー】` blocks. Fields not on the page are omitted. `get_schedule` items include `sessions` when their description has 部 times.

### Goods store (v0.4.0): `StoreCategory`, `StoreProductSummary`, `StoreProduct`
The source is the official goods store at `store.plusmember.jp/sakurazaka46`. It runs EC-CUBE 2, has no JSON API, and is read from server-rendered HTML.
- `StoreCategory = { id, name, level, url }`.
- `StoreProductSummary = { product_id, name, url, thumbnail?, price (tax-incl yen), price_text, tax_included, labels?, sold_out?, sub_text? }`.
  - Lists are 50 per page with `{ total, page, per_page, pages, category_name }`.
  - Page 1 is a GET. Later pages POST the list's own `pageno` paging form, because the store ignores `pageno` in a GET. This is read-only.
  - A page past the end returns `items: []` with a `note`. The store would otherwise silently return page 1 again.
- `StoreProduct = { product_id, item_code, name, url, price, price_text, tax_included, item_price, categories[], labels?, comment, content, content_date, sales_start_text?, weight, image, images[], variation_labels?, variations?: [{classcategory_id1, classcategory_id2?, label, in_stock:true}], in_stock?, sold_out?, stock_flg, stock_source:'detail_page_signals', stock_note, description_text }`.

**Stock (what is public):** these findings come from checking real products on 2026-10-16, including a guest-cart test (no login, nothing entered).
- `in_stock` is `false` when the product shows the **SOLD OUT** label. Fully sold-out products also have no add-to-cart button.
- `in_stock` is `true` when the add-to-cart button is shown and there is no SOLD OUT label. Otherwise it is omitted.
- **Sold-out variations are removed from the size/colour selector.** Example: the stadium jumper 114894 lists sizes M/L/XL in its description, but the selector offers only XL. Adding size M to the cart is refused with 「…/M」は売り切れました. So `variations[]` lists only purchasable variations, each with `in_stock: true`. Sold-out variations are not listed and are never invented.
- `stock_flg` is the store's raw, undocumented flag. Observed values: 2 on in-stock items, and 0 on fully sold-out items and on 114894, which had only XL left. It is passed through raw and is **not** a count.
- **Numeric stock counts are not public.** A guest cart caps every line at the per-order sale limit (「一度に購入できる数量は50までです」), so a quantity probe shows "≥ 50" for normal stock. Since v0.4.1, `check_store_stock` runs this probe on request (see below).

Image URLs from store tools go through the shared filter with the store hosts allowed: `store.plusmember.jp`, `storage-store.plusmember.jp` and `image.emtg.jp`. The store's `user_data/.../img/common` chrome is dropped, including the `cover.gif` lazy-load placeholder; the real thumbnail comes from the background-image.

### Cart stock probe: `check_store_stock` (v0.4.1)
**This tool creates a guest cart session on the live store.** It is enabled by default. Set `SKZ46_DISABLE_CART_PROBE=1` in the server's environment to disable it; calls then return a clear error and make no request.

Each call does the following:
1. Uses a fresh, isolated cookie jar (a new guest session) and opens the product page.
2. If the product shows SOLD OUT or has no add-to-cart button, it answers `available: false` without touching the cart.
3. Otherwise it adds **50** (the store's per-order cap) of the product or variation and reads the cart line and messages.
4. In a `finally` block it **always deletes every cart line and re-reads the cart to verify it is empty** (`cart_emptied`).
5. It never goes to checkout, never logs in and never sends personal data. A call is about 5–6 requests, each at least 1 s apart.

`{ product_id, name, classcategory_id1, classcategory_id2, requested_quantity: 50, probe: 'guest_cart', available, at_least, exact, exact_basis, capped_by_order_limit, order_limit, variation_listed_on_page, message_raw, cart_line, cart_emptied, cart_touched, cleanup_error, reservation_note }`
- `at_least`: how many the cart accepted. 50 means "at least 50"; `capped_by_order_limit` is then true and `exact` is `null`.
- `exact`:
  - It is set to 0 when the store says 売り切れました, e.g. 114894 size M.
  - It is set to the accepted quantity when the cart cut the requested 50 to fewer. That behaviour was **not observed**: every in-stock variation probed on 2026-10-16 accepted 50. In EC-CUBE 2, the cart lowers an over-limit quantity to the smaller of stock and the sale limit, so a smaller number would mean stock.
- **Reservation:** adding to cart does **not** reserve stock (high confidence).
  - Every product page says 「ご注文確定するまでは、カートに商品が入っていても在庫は確保されていません。ご注文手続き中に在庫切れとなる場合があります。」 (until the order is confirmed, items in the cart are not secured).
  - In EC-CUBE 2 the stock is decremented only when an order is placed, not when an item is added to the cart.
  - The probe also empties its cart immediately.

### SpecialPageRef / SpecialPage (v0.3.0)
`SpecialPageRef = { slug, title?, date?, url, source: 'live'|'archive', thumbnail? }` comes from `list_special_pages`. Items are de-duplicated by slug; when a page is on both lists, the live entry wins.
`SpecialPage = { slug, url, title?, text, truncated?, text_length?, images?: string[], links?: {url, text?, external?}[], videos?: {provider:'youtube'|'brightcove', id, url?, account?}[] }`.
`text` is plain text from the page `<body>`. Headings become `#`/`##` lines; scripts, styles, nav, the site header, footer, cookie banner and share widgets are removed. It is capped at 20,000 characters, with `truncated: true` when cut. No page-specific fields are parsed, because the pages are hand-built landing pages.

### Image filter (all tools, v0.3.0)
`server/images.js` handles every image the tools return (`images[]`, `thumbnail`, `jacket`, `avatar`/`card`/`cheki`, `image`):
- Makes URLs absolute (https) and removes `?ima=0000`.
- Prefers the largest `data-srcset`/`srcset`, then `data-src`/`data-original`/`data-lazy-src`, over a placeholder `src`.
- Drops `data:` URIs, 1×1 or `display:none` pixels, and third-party hosts. Only `sakurazaka46.com` and `*.sonymusic.co.jp` are kept, so the Facebook pixel, OneTrust logos and YouTube thumbnails go.
- Drops site-chrome paths `/files/14/s46/img/`, `/files/14/s46/images/`, `/files/14/common/` and `/files/14/app/`.
- Drops file names matching icon/arrow/logo/sprite/spacer/blank/loading/placeholder/noimage/btn/share/sns/emoji, and `.svg`/`.ico`.
- Removes duplicates.
- Content images are kept: `/images/14/...`, `/files/14/diary/...` blog photos and per-page `/files/14/sakura/pages/<slug>/images/...` art.

## Members, aliases and fan terms (v0.4.0)
- `server/members.json` was scraped once on 2026-10-16 from `/s/s46/search/artist?display=generation` and each `/s/s46/artist/<id>` profile (`name`, `kana`, `eigo` romaji). No network calls are made at runtime.
- `aliases` holds only mechanically derived zh-Hant/zh-Hans spellings, each with a `source`. No curated nicknames are included because none could be sourced from official pages. To add one, use `{alias, lang, source}` with a public source.
- `list_blog_posts`, `list_greeting_cards` and `get_schedule` accept `member` (a name or alias) as well as `member_id`. Ambiguous names return an error that lists the candidates.
- `get_schedule` has these filters:
  - `label`: the exact site sub-type, e.g. テレビ, ラジオ, 雑誌, 配信, WEBメディア, 新聞, ライブ.
  - `member` and `keyword`.
  - `genre: "music_tv"`: a heuristic music-program title list. Items carry `genre_match: "heuristic"`.
- The `member` filter keeps only items that list that member, so group-wide items (member shown as 櫻坂46) are excluded.
- SKILL.md has a zh/ja fan-term glossary that maps terms to tools and params.

## Hub-compat conventions (v0.4.0)
- **Explicit nulls:** when a field is empty at the source or could not be parsed, it is returned as `null` instead of being left out. This applies to every tool. Empty strings become `null`. Optional lists are `null` when empty, while result containers (`items`) stay `[]`.
  - Exceptions: `content` is left out when `include_content: false`, and `raw` only appears when requested.
- **`raw: true` (every tool):** the result also has `raw: [{ url, method, http_status, content_type, fetched_at, sha256, body }]`, with one entry per upstream request the call made, in order.
  - `fetched_at` is ISO 8601 UTC.
  - `sha256` is the hex digest of the UTF-8 body text exactly as received. `body` is that raw text.
  - Requests answered from the per-process discography cache (used by `get_formation` to resolve codes) make no upstream request, so they don't appear.
- **Opt-in behaviour:** `get_formation` center inference needs `infer_center: true`. Sony Music calls need `include_sonymusic: true`.

## `ask`: one-call entry point (v0.4.1)

`ask {query, date_range?}` is listed first and is the recommended entry point. It parses the question with fixed rules, with no model and no guessing: fan terms (音番, 見面會/ミーグリ 第N部 + city, ブログ/部落格, N單 / 第N張單曲 / Nth シングル, C位/センター, 站位/選拔, 周邊/グッズ 有貨嗎/在庫, 行程/スケジュール, 電視/ラジオ/雜誌, 新聞), member names and nicknames (incl. kanji variants 島/嶋, 崎/﨑 and zh spellings), and JST dates (今天, 明天, 這週, 下週, 下個月, N月, M/D). It then calls the matching tool or tools and returns `{interpreted_as:{intent, params, members, dates, notes}, confidence, ambiguous, result, next}`. If the intent or member is ambiguous (e.g. "遠藤 blog"), it returns `candidates` and calls nothing.
- Meet&greet with a city or 第N部: reads at most 3 matching event pages and returns only the matching sessions.
- Stock questions: searches the store. If exactly one product matches, it returns `get_store_product` (public in_stock) and suggests `check_store_stock` in `next`. It never runs the cart probe by itself.
- Center: calls `get_formation` with `infer_center: true` and returns a per-song `centers[]` with source/confidence (official evidence = high, front-row middle = medium).

- **Upcoming first (JST).** Meet&greet, schedule and live/concert questions only look at future events, unless the query clearly asks about the past: a single number (N單/第N枚), 上次/之前/去年/過去/已經, or an explicit past date. A schedule question with no date covers the next 30 days.
  - Meet&greet with no upcoming match: returns `none_upcoming: true`, an empty `matches`, and `latest_past_event` + `next_hint` as a pointer only, not as the answer.
  - Live/concert questions (e.g. "大阪演唱會", intent `live`): checks schedule items labeled ライブ for the next 3 months plus LIVE special pages, matching the city in kanji or romaji (OSAKA). If nothing upcoming matches, it returns past matches from the last 6 months, each marked `is_past: true`, with a "no upcoming" note. It also lists upcoming live pages that name no city in `other_upcoming_live_without_city_match`.

  - **Solo vs festival (heuristic, `live_type_source: 'heuristic'`):** each live item gets a `live_type`. `festival` means a multi-artist event (フェス/FESTIVAL, GIGANTIC, ROCK IN JAPAN, COUNTDOWN JAPAN/CDJ, TIF, アラバキ, SUMMER SONIC, JAPAN JAM, 音楽祭, …). `solo` means Sakurazaka46's own lives (櫻坂46「…」, BACKS LIVE, ANNIVERSARY LIVE, ARENA TOUR/ツアー, 期生LIVE, …). Anything else is `unknown`.
    - 演唱會/公演/ライブ/ツアー queries are answered with solo (and unknown) items only. 音樂節/フェス/festival names are answered with festivals only.
    - If a concert query finds no solo match, festivals may be attached as `festival_hint`, labeled hint-only and not the answer. The upcoming-first rule applies to both.

  - **Venues:** `server/venues.json` maps about 40 major venues (Osaka, Tokyo, Kanagawa, Saitama, Chiba, Aichi, Fukuoka, Hokkaido, Miyagi, Hiroshima, Hyogo, Kyoto, Kagawa) and their aliases to city/prefecture. The venue is read from schedule 【会場】 lines and from live pages (### 会場 / 会場・日程; up to 4 upcoming pages are read). Items carry `venue`, `venue_raw`, `city` and `prefecture`. A query matches on city OR venue, and venue names work directly (e.g. "京セラ ライブ").

  - **Past fallback covers all history** (schedule back to 2020-10, LIVE + ARCHIVE pages; the meet&greet list API is already complete). Results are newest first, capped (3 shows for live, 10 items for schedule), and labeled `is_past: true` with a "no upcoming" note. Multi-day shows are merged into `dates[]`. Tour legs are matched to the date via 《県》venue blocks. Cost: about 1 s per month walked back; once at least one match is found it stops after about 50 s.

Every result also has `next`: suggested follow-up calls `{tool, params, why}` (e.g. list → detail), or `null`.

Offline eval: `node test/eval.mjs` (54 fan queries + 10 live_type cases in `test/eval-queries.json`).

## Tools
| Tool | Args | Upstream |
|---|---|---|
| `list_news` | `dy?` (YYYY\|YYYYMM\|YYYYMMDD), `category?`, `offset?`, `include_content?`=true | `/s/s46/api/json/news?dy=&cd=&st=` |
| `list_blog_posts` | `member_id?`, `offset?` | `/s/s46/api/json/diary?cd=blog&member_id=&st=` (no body) |
| `list_meet_greet_events` | — | `/s/s46/api/list/shakehands_list` |
| `list_store_categories` | — | store.plusmember.jp/sakurazaka46 menu (HTML) |
| `list_store_products` | `category_id?`, `keyword?`, `page?` | `products/list.php` (GET page 1; POST `pageno` form for later pages) |
| `get_store_product` | `product_id` | `products/detail.php` (HTML; hidden `div.__items__*` block + selectors) |
| `check_store_stock` | `product_id`, `classcategory_id1?`, `classcategory_id2?` | **live guest-cart probe** on store.plusmember.jp (enabled by default; set `SKZ46_DISABLE_CART_PROBE=1` to turn it off) |
| `resolve_member` | `query` | static table `server/members.json`, built from the official member list and profiles (31 current members: id, name, kana, romaji, generation, derived zh aliases) |
| `list_special_pages` | — | LIVE list + all ARCHIVE list pages (HTML) → `SpecialPageRef[]` |
| `get_special_page` | `slug` | `/s/s46/page/<slug>` (HTML) → `SpecialPage` |
| `get_meet_greet_event` | `code` | `/s/s46/diary/detail/<code>?cd=event_page` (HTML) → `MeetGreetDetail` |
| `get_schedule` | `date?` YYYY-MM-DD \| `month?` YYYY-MM, `category?` | `/s/s46/media/list?dy=` HTML: embedded `var scheduleEvents=[…]` + modal blocks |
| `get_formation` | `single?` (int), `list?` | `/s/s46/page/formation` HTML (`div.list_wrap`) |
| `get_blog_post` | `id` | `/s/s46/diary/detail/<id>?cd=blog` HTML (`div.box-article`) |
| `list_discography` | — | `/s/s46/artist/00/discography` HTML (`li.box`) |
| `get_discography` | `code` | `/s/s46/discography/<code>` HTML **+ third-party** `https://www.sonymusic.co.jp/json/v2/artist/sakurazaka46/discography/<code>` (JSONP, `callback(...)` stripped) |
| `list_greeting_cards` | `member_id?` (filtered client-side; `ct` is never sent because it empties the result) | `/s/s46/api/list/greeting` |

Notes on the v0.2.0 tools:
- **Schedule:** `dy=YYYYMM` returns that month. `dy=YYYYMMDD` also returns the **whole month**, so filtering by `date` and `category` happens in the plugin.
- **Third-party source (opt-in):** track lists, prices and bonuses in `get_discography.sonymusic` come from **Sony Music Japan**'s JSON (the same request the official page makes). Since v0.4.0 the call is made only when `include_sonymusic: true`; otherwise `sonymusic` is `null`. If the call fails, the official part is still returned along with `sonymusic_error`.
- **Formation center:** the page has **no explicit center marker**.
  - Since v0.4.0, position-based inference is **off by default**. Without official evidence, `center`, `center_source` and `center_confidence` are `null`.
  - Pass `infer_center: true` to get the middle member of an odd-sized front row, with `center_source: 'front_row_middle'` and `center_confidence: 'medium'`. An even or empty front row still gives `null`.
  - Official evidence (below) is always returned, with `center_source: 'official'`.
  - It becomes `center_source: 'official'` with `center_confidence: 'high'` only when the static file `server/center-evidence.json` cites official evidence (a news item or special/TV page URL plus a quote). That file was hand-verified on 2026-10-16: the title songs of singles 1–11 and 13–16, 15's 2nd A-side, and 11 coupling songs.
  - If official evidence names someone other than the middle member, the official name wins and `center_note` explains the difference.
  - No news is crawled at runtime. New singles have no center (or medium with `infer_center`) until someone adds evidence to the file.
  - `get_formation` also takes `album: N`.
- **Errors:** if the expected HTML anchors are missing, the tools return `page structure changed: … not found at <url>`.

Upstream behaviour:
- News and blog return at most 200 items per request. `offset` maps to the upstream `st` (0-based).
- Calls to upstream are spaced at least 1 s apart.
- Errors come back as MCP `isError` results: non-200 status, non-JSON body, or `{"result":"NG"}`.

## Install

The MCP server ships as the npm package **`skz46-official-mcp`**. It has no dependencies and needs Node ≥ 18. Every client starts it the same way:
```
npx -y skz46-official-mcp
```

**As an Agent Plugin (Cursor or any Agent Plugins host):** use this directory as-is. `plugin.json` plus `mcp.json` declare the server (`npx -y skz46-official-mcp`, with no path variables) and the skill in `skills/`. For a local test in Cursor, copy or symlink the directory to `~/.cursor/plugins/local/skz46-official`.

**Cursor (MCP only)**: add this to `~/.cursor/mcp.json` or `.cursor/mcp.json`:
```json
{ "mcpServers": { "skz46-official": { "command": "npx", "args": ["-y", "skz46-official-mcp"] } } }
```

**Claude Code:** `claude mcp add skz46-official -- npx -y skz46-official-mcp`

**Claude Desktop:** add the same `mcpServers` entry as for Cursor to `claude_desktop_config.json`.

**Other MCP clients (stdio):** command `npx`, args `["-y", "skz46-official-mcp"]`. Or install it globally with `npm i -g skz46-official-mcp` and use the command `skz46-official-mcp`.

**Before it's published to npm:** run `npm pack` and point npx at the tarball: `npx -y --package=/abs/path/skz46-official-mcp-0.1.0.tgz skz46-official-mcp` (a bare `npx -y <tarball>` fails with "Permission denied").

## Layout
```
plugin.json          Agent Plugins manifest
mcp.json             stdio server definition (npx -y skz46-official-mcp)
package.json         npm package (bin: skz46-official-mcp -> server/index.js)
LICENSE              MIT
server/index.js      MCP server (JSON-RPC 2.0: initialize, tools/list, tools/call, ping) + JSON tools
server/html-tools.js HTML-scraping tools (schedule, formation, blog post, discography)
server/center-evidence.json  hand-verified official center citations
skills/sakurazaka46-official/SKILL.md
test/smoke.mjs       end-to-end test against the live site
```

## Test
`node test/smoke.mjs [command args...]` spawns the server (by default `node server/index.js`), runs initialize, ping and tools/list, then calls every tool against the live site. Examples:
`node test/smoke.mjs npx -y --package=$PWD/skz46-official-mcp-0.1.0.tgz skz46-official-mcp` or `node test/smoke.mjs skz46-official-mcp`.

## Publishing (owner)
```
npm login
npm publish --access public
```
The package contents are limited by the `files` field to `server/`, `README.md` and `LICENSE`. `package.json` is always included.
