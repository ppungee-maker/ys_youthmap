# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

There is no build, lint, or test tooling — the entire app is a single static HTML file.

- Preview: open `index.html` directly in a browser (`file://` works for everything, including Geolocation).
- To test under `http://` instead (e.g. for stricter permission/CORS behavior), serve the directory: `python3 -m http.server` and visit `http://localhost:8000/index.html`.

## Architecture

Everything — markup, CSS, inline SVG artwork, and JS — lives in the one `index.html` file. No framework, no external JS libraries, no package manager. Google Fonts (`Jua`, `Gowun Dodum`) are pulled via `<link>` tags.

**The map is a stylized illustration, not a geographic projection.** The big SVG (`#islandSvg`) hand-draws Yuseong-gu's 13 행정동 as a single cohesive "treasure island," loosely echoing real road/river shapes (유성대로·대덕대로·북유성대로, 갑천) but with no real coordinate system behind it. Every pin, chest, and the post-office icon is placed with `left`/`top` **percentages** chosen by eye against this artwork — they do not correspond to real lat/lng. An earlier iteration that tried to make the map literally GPS-accurate was explicitly reverted; don't reintroduce that conflation without confirming with the user first, since "real map" has caused repeated back-and-forth in this project (see the `실제 지도` ambiguity: GPS accuracy vs. visual-style reference are two very different asks).

**Data model** (all in the `<script>` at the bottom of `index.html`):
- `FACILITIES` — the 11 real youth facilities. Each entry has both the artistic placement (`left`/`top`, %) *and* a real `lat`/`lng` (geocoded from each facility's actual address via Nominatim). The two are independent: `left`/`top` drives where the pin sits on the illustration; `lat`/`lng` is used only for real-world distance calculations and is never used to position anything on the map.
- `CHESTS` — 5 symbolic 급식카드(아이누리카드) zones, one per region. These represent a whole zone, not a single address, so they carry `left`/`top` only, no `lat`/`lng`.
- `NOTICES` — post-office bulletin items; `id` is a sortable date string used to compute the unread badge.
- `ICONS` / `REGION_BADGE` — lookup tables mapping a facility's `cat` (category) to pin artwork and a facility's `region` (1–5) to a badge color.

**Rendering pipeline:** JS builds every pin/chest/post/locate button at runtime from the arrays above and appends them into `#pinLayer` (percent-positioned, absolute, relative to `#mapWrap`). Icon markup comes from small SVG-string generator functions (`pinSvg`, `chestSvg`, `postSvg`, `locateSvg`) rather than static `<img>`/sprite assets.

**Modal system:** a single native `<dialog id="modal">` is reused for every detail view (facility info, chest/meal-card info, post notices, the "nearby facilities" list, and geolocation status/errors). Content is swapped by overwriting `#modalInner.innerHTML` and calling `showModal()`; check `modal.open` before calling it again to avoid `InvalidStateError` when updating content on an already-open dialog (e.g. loading → result).

**Geolocation "find nearby" feature:** decoupled from the visual pin system by design. `navigator.geolocation` gets the user's real coordinates, which are compared to each facility's real `lat`/`lng` via a haversine distance function and ranked. The user's own position is **never** plotted on the map (the illustration has no real projection to place it against) — picking a result from the ranked list instead scrolls to and briefly flashes (`.pin.flash`) the corresponding pin already on the map.

**Persistence:** a single `localStorage` key, `yuseong_lastSeenNotice`, tracks the newest notice `id` the user has seen, used to compute the unread badge on the post-office icon.

**Note:** the file intentionally starts directly with `<title>`/`<style>` (no `<!DOCTYPE html>`/`<html>`/`<body>` wrapper), which puts the page in browser Quirks Mode. This is pre-existing and the page renders correctly despite it — not something to "fix" incidentally while making unrelated changes.
