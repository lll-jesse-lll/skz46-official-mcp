# skz46-official (v0.4.3)

## v0.4.3 changes
- **Store questions in `ask` no longer send question words to the store.** Before, 「現在有哪些石森璃花的推しメンタオル」 searched the store for 「現在有哪些石森璃花 推しメンタオル」 and got 0. Words like 現在／目前／有哪些／有什麼／有沒有／還有／嗎／呢／ありますか are removed first. The member is turned into the official spelling as separate terms (りか, 山崎天, 中島優月 → 石森 璃花, 山﨑 天, 中嶋 優月). Product words are split into store terms (推しメンタオル → 推しメン タオル). A few obvious zh terms are mapped, each to a term checked on the live store on 2026-10-17: 毛巾→タオル, 應援毛巾→マフラータオル, 生寫真→生写真, 立牌/アクスタ→アクリルスタンド, 鑰匙圈→キーホルダー, T恤→Tシャツ, 帽T→パーカー, 螢光棒→ペンライト, 徽章→缶バッジ, 手環→ラバーバンド, 托特包→トートバッグ, 貼紙→ステッカー.
  - The store's name search requires every space-separated term (AND), so one search with member + product terms is the intersection. Results are re-checked against the terms. Unrecognized extra words are dropped in a second try.
  - If nothing matches, the result lists every keyword searched with its total (all terms, member only, product only) and `next` suggests the member-only and product-only searches. The zero is for those exact keywords only.
  - Result fields: `searched: [{keyword, total, matched_on_page, why}]`, `store_terms: {member, member_terms, product_terms, extra_terms}`, `match`, `note`.
- **Product pictures as MCP image content.** `get_store_product` (main image), `list_store_products` and `ask` store answers (first 6 thumbnails) add `{type: 'image', data: <base64>, mimeType}` blocks after the JSON text. Image URLs stay in the JSON.
  - `max_images` (0–12; 0 = none). Caps: 400 KB per image (`SKZ46_IMAGE_MAX_BYTES`), 1.5 MB total (`SKZ46_IMAGES_MAX_TOTAL_BYTES`). Only store image hosts are fetched (storage-store.plusmember.jp, store.plusmember.jp, image.emtg.jp), on their own queue at least 300 ms apart, with a 10 s timeout. Failed, oversize or non-image files are skipped and listed in `images_skipped` with a reason; `images_attached` lists what was sent.
  - `SKZ46_DISABLE_IMAGES=1` turns images off (text only, `images_note` says so). Image downloads are not recorded in `raw: true`.

Agent Plugin (Agent Plugins 1.0.0 format) that wraps the **public, no-login** JSON endpoints of https://sakurazaka46.com in a zero-dependency stdio MCP server (Node ≥ 18, uses the built-in `fetch`).

## v0.4.2 changes (read this if you upgrade)
**Behaviour changes (may affect existing callers, e.g. SKZ HUB):**
- **`list_news` now returns short items by default.** Defaults: `limit: 20`, `include_content: false`. Items have no `content`; they carry `content_excerpt` (plain text, about 120 chars) instead. All other fields are unchanged (`id`, `title`, `caption`, `url`, `published_at`, `pubdate`, `category`, `category_label`, `tags`, `thumbnail`).
  - To get the v0.4.1 output back, pass `include_content: true, limit: 200`. Responses above `max_bytes` (default 600,000 bytes of item JSON, env `SKZ46_MAX_RESPONSE_BYTES`) are cut at a whole-item boundary with `truncated: true` and a `next` hint (`offset`). Pass a larger `max_bytes` (up to 20,000,000) to avoid the cut.
  - New result fields: `limit`, `returned`, `include_content`, `has_more`, `truncated`, `truncated_reason`, `items_bytes`, `next` (next page).
  - `raw: true` is unchanged: `raw[].body` is the full upstream response (all items, full HTML) with its sha256, never cut. The upstream URL is the same as before for the same `dy`/`category`/`offset`.
- **`check_store_stock`** still tries 50 (the per-order cap) by default, and now says plainly what that means: `stock_level: 'plenty'` (at least 50) vs `'low'` with `remaining_exact: N` (the store cut 50 to the N left) vs `'sold_out'`, plus a one-line `summary`. `probe_quantity` (1–50) is optional.
  - Cleanup is reported, never assumed: `cart_cleanup: 'ok' | 'failed' | 'not_needed'`, `cleanup_attempts` (up to 3 delete rounds, then a final check), `cleanup_error`, `cleanup_note`. `cart_emptied` stays (true only when the store showed its empty-cart message).
- **`get_blog_post` / `get_meet_greet_event` cap `body_text` at 20,000 chars** by default (`max_chars` up to 100,000), with `body_truncated` and `body_length`. `get_special_page` takes `max_chars` too, and always returns `truncated` (boolean) and `text_length` (full length).

**Fixes:**
- **One call gives the answer.** History searches have **no whole-call time limit by default**: `ask` keeps walking back until it finds enough or reaches the start of history (2020-10). Each upstream request has a timeout (default 15 s, env `SKZ46_FETCH_TIMEOUT_MS`, via `AbortSignal`) and a timed-out or failed GET is retried up to 2 times (env `SKZ46_FETCH_RETRIES`; POSTs are never retried), so a hung upstream cannot stall a call forever. Long walks send MCP `notifications/progress` when the client passes a `progressToken`.
  - Results of a history walk carry `searched_range: {from, to}` (months actually covered), `history_start`, `history_complete`, `stop_reason` (`enough` | `history_start_reached` | `upstream_timeout` | `upstream_error` | `deadline`) and `continue_before`. If a walk stops early (repeated upstream failure, or an opt-in deadline), the result says `truncated: true`, which months were not searched, and gives a `next` hint `{tool: 'ask', params: {query, before: 'YYYY-MM'}}` to continue; it never claims "no results". `before` can also be passed by hand to search only older months.
  - **Opt-in deadline:** set `SKZ46_DEADLINE_MS` (e.g. 45000) for hosts that kill long calls. Then searches stop at that time with `truncated_by_deadline: true` and the `next` cursor above, other tools return an error that says it is not a "no results" answer, and `list_special_pages` returns the pages it already read with `truncated: true`.
  - `ask` reuses the special-page list for 10 minutes (it costs ~9 requests). Direct `list_special_pages` calls always fetch.
- **stdout is flushed before exit** when the client closes stdin, so the last large reply is never cut.

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
  content?: string | null; // article HTML; only with include_content:true (default false since v0.4.2)
  content_excerpt?: string | null; // plain-text start of content (~120 chars); given when include_content is false
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

The list tools return `{ total, offset?, items }`. `total` is the upstream `count` for news and blog, and `items.length` for the other two tools. `list_news` (v0.4.2) also returns `limit, returned, include_content, has_more, truncated, truncated_reason, items_bytes, next`. Note that the MCP reply carries the JSON twice (`content[0].text` and `structuredContent`), so the bytes on the wire are about 2× `items_bytes`.

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
- **Numeric stock counts are not public.** A guest cart caps every line at the per-order sale limit (「一度に購入できる数量は50までです」), so a quantity probe shows "≥ 50" for normal stock. Since v0.4.1, `check_store_stock` runs this probe on request (see below); since v0.4.2 it reports `stock_level` plenty / low (exact N) / sold_out.

Image URLs from store tools go through the shared filter with the store hosts allowed: `store.plusmember.jp`, `storage-store.plusmember.jp` and `image.emtg.jp`. The store's `user_data/.../img/common` chrome is dropped, including the `cover.gif` lazy-load placeholder; the real thumbnail comes from the background-image.

### Cart stock probe: `check_store_stock` (v0.4.1, quantity/cleanup reporting v0.4.2)
**This tool creates a guest cart session on the live store.** It is enabled by default. Set `SKZ46_DISABLE_CART_PROBE=1` in the server's environment to disable it; calls then return a clear error and make no request.

Each call does the following:
1. Uses a fresh, isolated cookie jar (a new guest session) and opens the product page.
2. If the product shows SOLD OUT or has no add-to-cart button, it answers `available: false` without touching the cart.
3. Otherwise it adds **50** (the store's per-order cap; `probe_quantity` 1–50 can override) of the product or variation and reads the cart line and messages.
4. It then **always deletes every cart line and re-reads the cart**, up to 3 delete rounds plus a final check, and reports the outcome as `cart_cleanup: 'ok' | 'failed'` (`'not_needed'` when the cart was never touched). 'ok' requires the store's own empty-cart message. Cleanup requests are not cut by an opt-in call deadline (they keep the 1 s spacing and the request timeout). If cleanup fails, the cart belongs to a throwaway guest session whose cookies are discarded; it reserves no stock and expires on the store side.
   If the probe itself fails (e.g. a timeout while adding), the error message still states `cart_cleanup=…`.
5. It never goes to checkout, never logs in and never sends personal data. A call is about 5–6 requests, each at least 1 s apart.

`{ product_id, name, classcategory_id1, classcategory_id2, requested_quantity, probe: 'guest_cart', available, at_least, exact, exact_basis, capped_by_order_limit, order_limit, variation_listed_on_page, message_raw, cart_line, cart_touched, cart_cleanup, cart_emptied, cleanup_attempts, cleanup_error, cleanup_note, reservation_note }`
- `stock_level`: `plenty` (the cart took all 50: at least 50 in stock, exact count not public), `low` (the store cut 50 to N: exactly `remaining_exact` = N left; buy soon), `sold_out`, `at_least_order_limit` (cut to the product's own per-order limit, not stock), `at_least_requested` (a smaller `probe_quantity` was fully accepted), or `unknown`. `summary` says it in one sentence.
- `at_least`: how many the cart accepted. 50 means "at least 50"; `capped_by_order_limit` is then true and `exact`/`remaining_exact` are `null`.
- `exact`:
  - It is set to 0 when the store says 売り切れました, e.g. 114894 size M.
  - It is set to the accepted quantity when the cart cut the requested quantity to fewer. On 2026-10-16 every in-stock variation probed accepted 50; on 2026-10-17 (v0.4.2 smoke test) a request for 50 of 114889 size S was cut to 26, so the reduction does happen. In EC-CUBE 2, the cart lowers an over-limit quantity to the smaller of stock and the sale limit, so a smaller number means stock (unless `order_limit` says the sale limit is that number).
- **Reservation:** adding to cart does **not** reserve stock (high confidence).
  - Every product page says 「ご注文確定するまでは、カートに商品が入っていても在庫は確保されていません。ご注文手続き中に在庫切れとなる場合があります。」 (until the order is confirmed, items in the cart are not secured).
  - In EC-CUBE 2 the stock is decremented only when an order is placed, not when an item is added to the cart.
  - The probe also empties its cart immediately.

### SpecialPageRef / SpecialPage (v0.3.0)
`SpecialPageRef = { slug, title?, date?, url, source: 'live'|'archive', thumbnail? }` comes from `list_special_pages`. Items are de-duplicated by slug; when a page is on both lists, the live entry wins.
`SpecialPage = { slug, url, title?, text, truncated?, text_length?, images?: string[], links?: {url, text?, external?}[], videos?: {provider:'youtube'|'brightcove', id, url?, account?}[] }`.
`text` is plain text from the page `<body>`. Headings become `#`/`##` lines; scripts, styles, nav, the site header, footer, cookie banner and share widgets are removed. It is capped at `max_chars` (default 20,000), with `truncated: true` when cut and `text_length` = the full length (v0.4.2: both always present). No page-specific fields are parsed, because the pages are hand-built landing pages.

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
  - Exceptions: `list_news` leaves `content` out unless `include_content: true` (and then leaves `content_excerpt` out), and `raw` only appears when requested.
- **`raw: true` (every tool):** the result also has `raw: [{ url, method, http_status, content_type, fetched_at, sha256, body }]`, with one entry per upstream request the call made, in order.
  - `fetched_at` is ISO 8601 UTC.
  - `sha256` is the hex digest of the UTF-8 body text exactly as received. `body` is that raw text.
  - Requests answered from the per-process discography cache (used by `get_formation` to resolve codes) make no upstream request, so they don't appear.
- **Opt-in behaviour:** `get_formation` center inference needs `infer_center: true`. Sony Music calls need `include_sonymusic: true`.

## `ask`: one-call entry point (v0.4.1)

`ask {query, date_range?, before?}` is listed first and is the recommended entry point. It parses the question with fixed rules, with no model and no guessing: fan terms (音番, 見面會/ミーグリ 第N部 + city, ブログ/部落格, N單 / 第N張單曲 / Nth シングル, C位/センター, 站位/選拔, 周邊/グッズ 有貨嗎/在庫, 行程/スケジュール, 電視/ラジオ/雜誌, 新聞), member names and nicknames (incl. kanji variants 島/嶋, 崎/﨑 and zh spellings), and JST dates (今天, 明天, 這週, 下週, 下個月, N月, M/D). It then calls the matching tool or tools and returns `{interpreted_as:{intent, params, members, dates, notes}, confidence, ambiguous, result, next}`. If the intent or member is ambiguous (e.g. "遠藤 blog"), it returns `candidates` and calls nothing.
- Meet&greet with a city or 第N部: reads at most 3 matching event pages and returns only the matching sessions.
- Stock questions: searches the store. If exactly one product matches, it returns `get_store_product` (public in_stock) and suggests `check_store_stock` in `next`. It never runs the cart probe by itself.
- Center: calls `get_formation` with `infer_center: true` and returns a per-song `centers[]` with source/confidence (official evidence = high, front-row middle = medium).

- **Upcoming first (JST).** Meet&greet, schedule and live/concert questions only look at future events, unless the query clearly asks about the past: a single number (N單/第N枚), 上次/之前/去年/過去/已經, or an explicit past date. A schedule question with no date covers the next 30 days.
  - Meet&greet with no upcoming match: returns `none_upcoming: true`, an empty `matches`, and `latest_past_event` + `next_hint` as a pointer only, not as the answer.
  - Live/concert questions (e.g. "大阪演唱會", intent `live`): checks schedule items labeled ライブ for the next 3 months plus LIVE special pages, matching the city in kanji or romaji (OSAKA). If nothing upcoming matches, it returns past matches (walking back over all history, see below), each marked `is_past: true`, with a "no upcoming" note. It also lists upcoming live pages that name no city in `other_upcoming_live_without_city_match`.

  - **Solo vs festival (heuristic, `live_type_source: 'heuristic'`):** each live item gets a `live_type`. `festival` means a multi-artist event (フェス/FESTIVAL, GIGANTIC, ROCK IN JAPAN, COUNTDOWN JAPAN/CDJ, TIF, アラバキ, SUMMER SONIC, JAPAN JAM, 音楽祭, …). `solo` means Sakurazaka46's own lives (櫻坂46「…」, BACKS LIVE, ANNIVERSARY LIVE, ARENA TOUR/ツアー, 期生LIVE, …). Anything else is `unknown`.
    - 演唱會/公演/ライブ/ツアー queries are answered with solo (and unknown) items only. 音樂節/フェス/festival names are answered with festivals only.
    - If a concert query finds no solo match, festivals may be attached as `festival_hint`, labeled hint-only and not the answer. The upcoming-first rule applies to both.

  - **Venues:** `server/venues.json` maps about 40 major venues (Osaka, Tokyo, Kanagawa, Saitama, Chiba, Aichi, Fukuoka, Hokkaido, Miyagi, Hiroshima, Hyogo, Kyoto, Kagawa) and their aliases to city/prefecture. The venue is read from schedule 【会場】 lines and from live pages (### 会場 / 会場・日程; up to 4 upcoming pages are read). Items carry `venue`, `venue_raw`, `city` and `prefecture`. A query matches on city OR venue, and venue names work directly (e.g. "京セラ ライブ").

  - **Past fallback covers all history** (schedule back to 2020-10, LIVE + ARCHIVE pages; the meet&greet list API is already complete). Results are newest first, capped (3 shows for live, 10 items for schedule), and labeled `is_past: true` with a "no upcoming" note. Multi-day shows are merged into `dates[]`. Tour legs are matched to the date via 《県》venue blocks. Cost: about 1 s per month walked back. Since v0.4.2 there is no time cut by default: one call walks until enough is found or 2020-10 is reached (a city with no show at all takes a few minutes, since each month costs ~3 s at the site). Results carry `searched_range` and `history_complete`; `before` and the opt-in `SKZ46_DEADLINE_MS` are described above.

Every result also has `next`: suggested follow-up calls `{tool, params, why}` (e.g. list → detail), or `null`.

Offline eval: `node test/eval.mjs` (54 fan queries + 10 live_type cases in `test/eval-queries.json`).

## Tools
| Tool | Args | Upstream |
|---|---|---|
| `list_news` | `dy?` (YYYY\|YYYYMM\|YYYYMMDD), `category?`, `offset?`, `limit?`=20 (≤200), `include_content?`=false, `max_bytes?`=600000 | `/s/s46/api/json/news?dy=&cd=&st=` |
| `list_blog_posts` | `member_id?`, `offset?` | `/s/s46/api/json/diary?cd=blog&member_id=&st=` (no body) |
| `list_meet_greet_events` | — | `/s/s46/api/list/shakehands_list` |
| `list_store_categories` | — | store.plusmember.jp/sakurazaka46 menu (HTML) |
| `list_store_products` | `category_id?`, `keyword?`, `page?` | `products/list.php` (GET page 1; POST `pageno` form for later pages) |
| `get_store_product` | `product_id` | `products/detail.php` (HTML; hidden `div.__items__*` block + selectors) |
| `check_store_stock` | `product_id`, `classcategory_id1?`, `classcategory_id2?`, `probe_quantity?`=50 | **live guest-cart probe** on store.plusmember.jp (enabled by default; set `SKZ46_DISABLE_CART_PROBE=1` to turn it off) |
| `resolve_member` | `query` | static table `server/members.json`, built from the official member list and profiles (31 current members: id, name, kana, romaji, generation, derived zh aliases) |
| `list_special_pages` | — | LIVE list + all ARCHIVE list pages (HTML) → `SpecialPageRef[]` |
| `get_special_page` | `slug`, `max_chars?`=20000 | `/s/s46/page/<slug>` (HTML) → `SpecialPage` |
| `get_meet_greet_event` | `code`, `max_chars?`=20000 | `/s/s46/diary/detail/<code>?cd=event_page` (HTML) → `MeetGreetDetail` |
| `get_schedule` | `date?` YYYY-MM-DD \| `month?` YYYY-MM, `category?` | `/s/s46/media/list?dy=` HTML: embedded `var scheduleEvents=[…]` + modal blocks |
| `get_formation` | `single?` (int), `list?` | `/s/s46/page/formation` HTML (`div.list_wrap`) |
| `get_blog_post` | `id`, `max_chars?`=20000 | `/s/s46/diary/detail/<id>?cd=blog` HTML (`div.box-article`) |
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
- Each request has a timeout (`SKZ46_FETCH_TIMEOUT_MS`, default 15000) and GETs are retried up to `SKZ46_FETCH_RETRIES` (default 2) times. A whole-call deadline exists only when `SKZ46_DEADLINE_MS` is set.
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
test/smoke.mjs       end-to-end test against the live site (also runs eval.mjs and offline.mjs)
test/offline.mjs     offline tests with a mocked fetch (one-call history walk, retries, opt-in deadline, news size, cart probe, EOF drain)
test/mock-fetch.cjs  test-only fetch mock preload
```

## Test
`node test/offline.mjs` runs the mocked (no network) suite in about 35 s. `node test/eval.mjs` runs the offline `ask` parser eval.
`node test/smoke.mjs [command args...]` spawns the server (by default `node server/index.js`), runs initialize, ping and tools/list, then calls every tool against the live site. Examples:
`node test/smoke.mjs npx -y --package=$PWD/skz46-official-mcp-0.1.0.tgz skz46-official-mcp` or `node test/smoke.mjs skz46-official-mcp`.

## Publishing (owner)
```
npm login
npm publish --access public
```
The package contents are limited by the `files` field to `server/`, `README.md` and `LICENSE`. `package.json` is always included.

## Disclaimer
**English.** This is an unofficial, fan-made project. It is not affiliated with, endorsed by, or sponsored by Sakurazaka46, Seed & Flower LLC, or Sony Music. All content, names, trademarks and images belong to their respective rights holders. The server fetches publicly available pages from the official site on demand and returns extracted text (including blog post and special page body text), links and image URLs; it does not download, store or rehost images. Please respect the official site's terms of use and view the originals on the official site. Rights holders may request changes or removal by opening a GitHub issue.

**日本語.** 本プロジェクトはファンによる非公式のものであり、櫻坂46、Seed & Flower合同会社、ソニーミュージックとは一切関係がなく、承認・後援を受けたものではありません。すべてのコンテンツ、名称、商標、画像の権利は各権利者に帰属します。本サーバーは公式サイトで一般公開されているページを必要に応じて取得し、抽出したテキスト（ブログ記事や特設ページの本文を含む）、リンク、画像URLを返します。画像のダウンロード・保存・再配布は行いません。公式サイトの利用規約を尊重し、原文・原画像は公式サイトでご覧ください。権利者の方は GitHub の Issue から修正・削除をご依頼いただけます。
