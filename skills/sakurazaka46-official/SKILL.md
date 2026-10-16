---
name: sakurazaka46-official
description: Look up Sakurazaka46 (櫻坂46) official-site data via the skz46-official MCP tools: news, member blogs (list and full text), the schedule (TV/radio/events), single formations, discography with track lists, MEET&GREET events and greeting cards. Use when the user asks what's new, what's on today or this month, who is center or front row, what a member wrote, or what's on a release.
---

# Sakurazaka46 official data

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

## When to use which tool
- **Latest news / announcements** (releases, goods, events, media, tickets, auditions): `list_news`. Filter by `dy` (YYYY, YYYYMM or YYYYMMDD) and/or `category`. Items carry `pubdate` (raw official string), `category_label`, `caption`, `tags` (member-id tags; `null` when there are none) and the article HTML `content`. Pass `include_content: false` for a lighter list.
- **Member blog posts**: `list_blog_posts`, with `member_id` for one member (the id in `/s/s46/artist/<id>`). Omit it to get all members' newest posts.
- **MEET&GREET / online individual talk events**: `list_meet_greet_events`.
- **A MEET&GREET session time** ("what time is part 3 in Kyoto?"): `list_meet_greet_events`, then find the `code` by single, city or date. Then call `get_meet_greet_event` with that `code` and pick from `sessions` by `city`/`venue`, `date` and `part`. Report `start_time`–`end_time` and the reception times (`reception_start`/`reception_end`) when present, and cite `url`.
  - One page may cover several venues or sub-events (`section`). Match on city and date, not only on the list entry.
  - If `sessions` is empty or has no matching part, say the page lists no time. Don't guess; quote `body_text` if useful.
  - `get_schedule` meet&greet items may also carry `sessions` parsed from their description.
- **Greeting card images for a member**: `list_greeting_cards` with `member_id`.
- **What's on today or this month** (TV, radio, magazines, events, releases, birthdays): `get_schedule` with `date` (YYYY-MM-DD) or `month` (YYYY-MM), optionally with `category`.
- **Who is in the front row or center, and the row lineup for a single**: `get_formation` (defaults to the latest single). Use `single: N` for a specific single, or `list: true` for every single and album with its song titles. Each song in `songs` has its own rows. Use `album: N` for an album.
  - **Center:** say "center" plainly only when `center_source` is `official` (cite `center_evidence.url`).
  - By default no position-based center is returned (`center: null`). Pass `infer_center: true` only if the user wants a best guess. A `front_row_middle` (medium) result must be described as inferred from the middle of the front row.
  - If `center` is missing, the front row is even-sized and the tool can't tell who the center is.
- **Read a blog post's text or images**: `get_blog_post` with the `id` from `list_blog_posts`.
- **Special sites** (live/tour pages, single specials, anniversary or Blu-ray pages): `list_special_pages` finds them (slug, title, date, source live/archive). `get_special_page` with `slug` reads one: text, images, links and videos.
  - The text is generic page text, not structured fields, so read it rather than expecting fixed keys.
  - If `truncated` is true, say the page was longer than what you saw.
  - Ticket and venue details on these pages are in `text` and `links`. Quote them; don't restate them as structured facts beyond what is written.
- **Official goods / merch store** (prices, what's on sale, sizes, sold out?): `list_store_categories` gives category ids.
  - `list_store_products` lists products by `category_id` and/or `keyword`, with `page` for more (50 per page). Category 2024 is 【通常配送】ALL ITEMS.
  - `get_store_product` with `product_id` gives the details.
  - Prices are tax-included yen (`price`).
  - **Stock:** say "sold out" only when `in_stock` is false or `sold_out` is true. When `in_stock` is true, say it can be added to cart.
  - `variations` lists only the sizes or colours still offered. A size named in the description but missing from `variations` is no longer offered, so it's probably sold out.
  - Never state stock quantities from `stock_flg`; it is not a count.
  - **"Is it still in stock / how many left?"** → `check_store_stock` with `product_id` (and `classcategory_id1` for a size or colour, from `get_store_product`).
    - It adds 50 to a temporary guest cart on the live store, then empties it.
    - Report `available`, and say "at least `at_least`" (50 means 50 or more). Give an exact number only when `exact` is not null.
    - Adding to cart does not reserve stock, so the answer can change at any moment.
    - Use it only when the user actually asks about stock, and don't call it repeatedly.
    - If it errors with `SKZ46_DISABLE_CART_PROBE`, the server owner has turned it off.
- **Releases**: use `list_discography` for every edition. Use `get_discography` with `code` for one edition's details. For the track list, price and bonuses, pass `include_sonymusic: true`. That data comes from Sony Music (third-party, in `sonymusic`), so say so if you cite it.

## Fan-language glossary (zh / ja → tool and params)
| Fan term | Means | Use |
|---|---|---|
| 音番, 音楽番組, 歌番組, 打歌 | music TV programs | `get_schedule` `genre: "music_tv"`. This is a heuristic title match with a conservative list of core shows (Mステ/ミュージックステーション, CDTV, うたコン, THE TIME,, ベストアーティスト, FNS歌謡祭, Venue101, THE MUSIC DAY, 紅白). MUSIC HOUSE is deliberately excluded. Say the match may miss shows. |
| 綜藝, 上電視, テレビ, 番組 | TV appearances | `get_schedule` `label: "テレビ"` |
| 廣播, 电台, ラジオ | radio | `get_schedule` `label: "ラジオ"` |
| 雜誌, 杂志, 雑誌, 封面 | magazines | `get_schedule` `label: "雑誌"`; `list_news` `category: "media"` |
| 配信, 直播, 生配信 | streams | `get_schedule` `label: "配信"` / `"生配信"` |
| 行程, 日程, スケジュール, 今天有什麼 | schedule | `get_schedule` with `date` / `month` |
| 公演, 演唱會, ライブ, ツアー, 巡演 | concerts / tours | `get_schedule` `label: "ライブ"`; `list_special_pages` / `get_special_page` (live sites, tickets); `list_news` `category: "ticket"` / `"event"` |
| 見面會, 握手, 握手会, ミーグリ, ミート＆グリート, 個握, 個別トーク会 | meet & greet | `list_meet_greet_events` → `get_meet_greet_event`; `get_schedule` `category: "shakehands"` |
| 部落格, 博客, ブログ | member blog | `list_blog_posts` (`member` accepts a name) → `get_blog_post` |
| 站位, 選拔, 选拔, フォーメーション, 隊形 | formation / lineup | `get_formation` |
| C位, センター, center | center | `get_formation`: official evidence only by default. `infer_center: true` gives a guess that must be labelled as one. |
| 單, 单曲, シングル N, Nth單 | single N | `get_formation` `single: N`; `list_discography` → `get_discography` |
| 專輯, アルバム | album | `get_formation` `album: N`; `list_discography` |
| 周邊, 周边, 週邊, グッズ, 物販, 商品 | goods / merch | `list_store_categories` / `list_store_products` / `get_store_product`; `list_news` `category: "goods"` |
| 新聞, 消息, お知らせ, ニュース | official news | `list_news` |
| 生日, 誕生日 | birthdays | `get_schedule` `category: "birthday"` |
| 期生, N期 (二期/三期/四期) | generation | `resolve_member` `query: "all"` (each member carries `generation`) |
| 成員, メンバー, (nickname or name) | a member | `resolve_member` `query`, or pass `member` to `list_blog_posts`, `list_greeting_cards` or `get_schedule` |

## Members
- `resolve_member` maps a name, kana, romaji, given or family name, or a zh-Hant/zh-Hans spelling (e.g. 山崎天, 谷口爱季, 中岛优月) to `member_id`. It covers the current roster of 31 from the official member list.
- If the result is ambiguous (e.g. 遠藤 matches 遠藤光莉 and 遠藤理子), ask which member is meant. Don't pick one.
- Aliases are only mechanical zh character conversions, each with its `source`. No fan nicknames are included, because none could be sourced officially. If a nickname doesn't resolve, ask for the member's name rather than guessing.
- Graduated members aren't in the table. Use their numeric `member_id` if known.

## Rules
- When quoting or summarizing official content (blog posts, news, special pages), always link back to the official URL returned by the tool.
- Empty fields are `null` (not missing). Treat `null` as "not on the source", never as a value to fill in.
- Every tool accepts `raw: true`, which adds the raw upstream responses (url, status, fetched_at, sha256, body). Use it only when provenance is needed, because it makes the response large.
- Image URLs are already filtered (logos, icons, tracking pixels, third-party images and duplicates removed) and absolute. Use them as-is and don't build image URLs yourself.
- Results are capped at 200 per call. If `total` is larger, page with `offset` (200, 400, …).
- `list_blog_posts` has no body. Use `get_blog_post` for the text.
- All times are JST (`+09:00`). Convert them to the user's timezone when you report them.
- If a tool says `page structure changed`, the site layout changed. Report that rather than guessing.
- Report only what the tools return. Never invent posts, dates, members or events. If a call errors or comes back empty, say so.
- The tools are read-only. There is no login or FC data, and the store tools never touch the cart.
