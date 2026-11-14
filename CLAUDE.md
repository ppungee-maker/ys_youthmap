# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

There is no build, lint, or test tooling — the entire app is a single static HTML file.

- Preview: open `index.html` directly in a browser (`file://` works for everything, including Geolocation).
- To test under `http://` instead (e.g. for stricter permission/CORS behavior), serve the directory: `python3 -m http.server` and visit `http://localhost:8000/index.html`.

## Architecture

Everything — markup, CSS, inline SVG artwork, and JS — lives in the one `index.html` file (~285KB, most of it embedded OSM path data). No framework, no external JS libraries, no package manager. Google Fonts (`Jua`, `Gowun Dodum`) are pulled via `<link>` tags.

**The map is drawn in a storybook style, but its geometry is real.** The big SVG (`#islandSvg`) draws Yuseong-gu's 13 행정동 as a single cohesive island. Only the decorative layer — trees, terrain shading, building icons, compass — is invented. The **outer boundary was traced from the real administrative boundary** (its bounding box has an aspect ratio of 0.589 against the real district's 0.593), and the **road network and waterways are real OSM geometry** projected onto it, not hand-drawn.

That makes a usable projection: linearly map real lon/lat onto the outline's bounding box (x from lon, y from **flipped** lat) and real coordinates land in the right place on the drawing. Facility and school positions were generated this way — see the comment above `SCHOOLS`. Markers that would overlap are nudged apart afterwards (schools average ~100m of displacement, max ~550m), so positions are accurate to the neighborhood, not the street.

Two coordinate systems meet here, and conflating them is the easiest way to break the map. The **projection** is anchored to the island's bounding box and never changes. The **viewBox** is a window onto it that extends well past the island (currently `-157 -361 1914 3248`, 22% padding on each side) so neighbouring Daejeon shows as muted context instead of empty space. SVG geometry uses projection coordinates directly, but markers are HTML positioned with CSS percentages of `.map-wrap`, which tracks the *viewBox* — so `left% = (x - viewBoxX) / viewBoxWidth * 100`. Change the viewBox and all 85 markers must be recomputed, along with the `aspect-ratio` on `.map-wrap` that mirrors it.

Roads come in two passes. The muted context band covers the whole viewBox and is drawn first, then the island fill paints over it, then the bright in-district roads go on top — so the context layer needs no clipping. Inside the district, roads are filtered to motorway/trunk/primary (drawn thick) and secondary/tertiary (thin); residential streets are deliberately excluded or the illustration disappears under them.

The five zone names are wooden signposts rather than flat labels, to suit the forest-adventure framing. Their positions are chosen by a small search that keeps each sign inside the island and clear of markers *while staying near its zone* — a zone name that drifts into the wrong neighbourhood is worse than one that overlaps a pin, so the search weights distance from the original spot heavily. Both roads and waterways are Douglas-Peucker simplified at 3px. Waterways are clipped by the SVG `landClip` path rather than by coordinate, because 갑천 runs *along* the district boundary and a strict point-in-polygon test discards nearly all of it. Road and river name labels are positioned at the point on each road's principal axis (PCA) that sits furthest from any pin — don't hand-place them.

Beware the history here: pin `left`/`top` percentages were originally chosen *by eye* and were off by up to 20% of map width; they were regenerated from real coordinates on 2026-11-04. If you add new markers, derive their position the same way rather than eyeballing. And keep the distinction straight when the user says "실제 지도" — GPS accuracy vs. matching a reference image's visual style are two very different asks, and conflating them has cost several rounds in this project.

**Zoom:** the two SVG layers zoom by **narrowing their `viewBox`**, not by CSS transform. This matters: a `transform: scale()` on an SVG (especially with `will-change: transform`) lets the browser rasterise the layer once and stretch that bitmap, so the map blurs exactly like a zoomed photo — the first implementation did this and had to be replaced. Changing the viewBox re-renders the vector, so lines stay sharp at any scale. The HTML marker layer cannot follow a viewBox, so `#pinLayer` keeps a matching `translate/scale` transform; the two are kept in sync from one `{z, tx, ty}` state via `vx = VX - tx·vw/width`. Three things deliberately do *not* grow with it. Markers counter-scale through a `--mk` custom property (`1/z`) — that is the point of zooming, since it pulls apart the pins that overlap at rest. Signposts get `scale(1/z)` appended after their `translate`, so the stake stays planted while the board keeps its size. Road strokes use `vector-effect="non-scaling-stroke"` with widths recomputed as `base × (mapWidth/1914) × z^0.4`; left to scale normally they swallow the map by 5×.

On touch, `touch-action` flips between `pan-y` at rest and `none` once zoomed — otherwise a one-finger drag over the map would trap the page scroll on a long phone page. Two-finger pinch works at any zoom.

**Alleys:** residential/unclassified/living_street/pedestrian ways (~52KB of path data) sit hidden under the main roads and fade in from z=2. `service` was excluded on purpose: it tripled the payload to 147KB and is mostly parking aisles, not the 골목길 people mean. Measuring the transform mid-animation is misleading — `.pin` carries a 0.12s transform transition, so read sizes after it settles or you will think counter-scaling is broken.

**Palette and the sea:** the ground was warm cream once — the most recognisable AI-design cliché — and is now water. Outside the district is painted as open sea (`--sea`), a storybook choice the user asked for over the earlier literal treatment of neighbouring districts as land.

The surrounding Daejeon road network is still drawn, but *over* the sea at very low opacity (`--sea-sunken`), reading as a city glimpsed under water. Two things were tried and rejected on the way: making the sea itself semi-transparent washes the blue out against the white page, and leaving those roads at normal stroke width makes the sea look like another landmass the moment you zoom. They now use `vector-effect="non-scaling-stroke"` at 1–2.6px so they stay hairlines at every scale.

**Data model** (all in the `<script>` at the bottom of `index.html`):
- `FACILITIES` — the 11 real youth facilities. `lat`/`lng` are geocoded from each facility's real address (Nominatim); `left`/`top` are derived from those via the outline projection above. 수련관·상담복지센터·미래교육지원센터 share one building (북유성대로 158), so their pins are fanned apart by hand or they stack exactly.
- `SCHOOLS` — 69 초/중/고 in Yuseong-gu, from an Overpass query clipped to the real district polygon. Same `lat`/`lng` + projected `left`/`top` shape as facilities.
- `CHESTS` — 5 symbolic 급식카드(아이누리카드) zones, one per region. These represent a whole zone, not a single address, so they carry `left`/`top` only, no `lat`/`lng`.
- `NOTICES` — post-office bulletin items. Reassigned wholesale when the Google Sheet loads, so read it, don't cache it. `id` is `date|title`, which is what the unread badge compares against.
- `LAYERS` — the chip row's state (청소년시설 / 급식카드 / 초 / 중 / 고). `applyLayers()` is the single place that reflects state onto markers; chips persist to `localStorage`.
- `ICONS` / `REGION_BADGE` — lookup tables mapping a facility's `cat` (category) to pin artwork and a facility's `region` (1–5) to a badge color.

**Rendering pipeline:** JS builds every pin/chest/post/locate button at runtime from the arrays above and appends them into `#pinLayer` (percent-positioned, absolute, relative to `#mapWrap`). Icon markup comes from small SVG-string generator functions (`pinSvg`, `chestSvg`, `postSvg`, `locateSvg`) rather than static `<img>`/sprite assets.

**Modal system:** a single native `<dialog id="modal">` is reused for every detail view (facility info, chest/meal-card info, post notices, the "nearby facilities" list, and geolocation status/errors). Content is swapped by overwriting `#modalInner.innerHTML` and calling `showModal()`; check `modal.open` before calling it again to avoid `InvalidStateError` when updating content on an already-open dialog (e.g. loading → result).

**Geolocation "find nearby" feature:** `navigator.geolocation` gets the user's real coordinates, which are compared against the real `lat`/`lng` of everything in the currently-enabled layers (facilities + whichever school levels are on) via haversine, ranked, and capped at 10. The user's own position is **never** plotted on the map — picking a result from the ranked list instead scrolls to and briefly flashes (`flashMarker`) the corresponding marker.

**Directions:** facility and school modals carry 길찾기 links that hand off to Kakao Map / Google Maps with the real `lat`/`lng` as destination. Routing is deliberately *not* computed in-page — the embedded network has no residential streets, so any route drawn here would diverge from the walk people actually take.

**Notices:** the post-office board reads from a public Google Sheet (gviz CSV endpoint, which does send CORS headers) so a non-technical maintainer can post without touching code — see `HOWTO-소식올리기.md`. `NOTICE_SHEET_ID` at the top of the script is the only thing to configure; empty means the notices hardcoded in the file are used. Every failure path — empty id, missing sheet, renamed columns, offline — falls back to those built-ins rather than showing an empty board, because nobody on the receiving end will be able to debug it. Notice text is sheet-authored, so it is escaped before it reaches `innerHTML`; keep it that way.

**Weather card:** bottom-left of the map, fed by two keyless CORS-friendly Open-Meteo endpoints (forecast + air-quality) for a fixed point near 유성구청 — deliberately not the user's position, so it renders without a location prompt. WMO weather codes map to one of six inline SVG icons; PM10/PM2.5 map to 환경부 grades. If either fetch fails the card stays hidden rather than showing a broken state.

**Persistence:** two `localStorage` keys. `yuseong_layers` holds the chip row's on/off state; `yuseong_seenNotices` holds the ids of notices already read, which drives the unread badge. It stores a list rather than a high-water date so that two notices posted on the same day both count as new.

**Mobile:** the page is phone-first in practice — the intended users are elementary students. Markers are sized in CSS pixels while the map scales with its container, so a pin that is 7% of the map on a desktop becomes 15% on a phone and swamps the island; the `max-width:560px` block shrinks every marker to compensate. Change marker sizes in both places or the phone layout silently regresses. There is no `<html>`/`<head>`/`<body>` wrapper, but the file does start with `<!DOCTYPE html>` plus charset and viewport meta — all three are required (without the doctype the page falls into Quirks Mode, without the viewport meta phones render it at desktop width).
