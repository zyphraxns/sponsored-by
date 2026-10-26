# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Upload your own logo.** The icon panel now has an upload button: SVG files are inlined and fitted by their own viewBox, bitmaps (PNG/JPEG/WebP) go in as data URLs rendered with `preserveAspectRatio`, and the original aspect ratio drives the slot width. Uploaded artwork keeps its own colours — it is never force-tinted.
- **SVGL-only brands are now searchable.** The brand index is the union of simple-icons and SVGL, so marks that were removed from simple-icons (OpenAI among them) are selectable again under the `svgl:` source; their symbol and wordmark both come from SVGL. Searches hit both sources.
- **Complete brand logotypes.** A ticker item can now render as an official full logotype (mark + name, e.g. OpenAI's flower plus wordmark) when one exists, falling back to the symbol plus the brand name set in the site's own type. 153 official wordmarks come from [SVGL](https://svgl.app) (MIT); everything else stays on simple-icons. Variants are picked by background luminance so a dark card gets the light-on-dark mark. Layout moved from fixed-pitch to variable-width slots to make room.
- **Colour mode.** Logos keep their own colours by default (a `mono` mode that forces the foreground colour remains available in code). Colour presets raise the GIF palette headroom to 64.

### Fixed

- **Moving any slider dropped every logo** — the async-fetched icon/wordmark assets don't come from the selection state, so rebuilding the scene for ROWS / SPEED / PALETTE silently discarded them, leaving only the typeset names. Rebuilds now carry assets across.
- **Speed was quadratic, not linear** — the period was already shortened by the speed factor and the scroll offset multiplied by it again (2× behaved as 4×). The offset no longer double-counts.
- **Loop length was inflated for non-integer periods** — the LCM accumulator started from 1, so `LCM(1, 2.5) = 5` reported a 2.5 s loop as 5 s. Harmless while speeds were integers, wrong the moment 1.6× existed.
- Wordmark variants are re-picked when the background luminance flips (a dark mark on a dark card used to disappear).
- **The icon panel showed no brand icons at all** — the simple-icons metadata JSON changed from an object to an array, the old parser silently produced an empty index, and the fallback endpoint 404s on `@latest`. Both sources are replaced (unpkg package meta for the slug list) and a built-in list of 60 popular brands guarantees the panel is never empty.
- **Selected brand icons were invisible in the preview** — `scene()` silently skips icons whose SVG has not been pre-fetched, and nothing ever fetched them outside exports. The preview now hydrates the same way exports do.
- The icon button label leaked Chinese ("图标") on the English UI.
- Two garbage entries (`UGh`, `糖果`) in the emoji quick-pick row.
- A single hung CDN request could stall the whole prefetch batch; all logo fetches now time out after 8 s.

## [0.2.0] - 2026-10-26

### Added

- **Brand icon library.** Ticker items can now be real brand marks from [simple-icons](https://simpleicons.org) instead of emoji: 3000+ single-colour SVGs fetched from the CDN at runtime, forced to one colour so the GIF palette stays small. The export path pre-fetches only the icons a scene actually renders.
- **Icon picker.** A searchable panel for choosing which brand marks appear in the ticker.
- **Title editing.** The headline is editable in the toolbar and updates the preview live.
- **Ticker controls.** Row count (1–12), speed (0.5×–2×, quantised to 1/20 steps so the global loop period stays finite), and background / foreground colour pickers.

### Fixed

- Editing the title and then moving any slider no longer resets the headline to the layout default.
- Dragging a slider no longer freezes the animation at `t = 0`, and no longer rebuilds the colour pickers mid-drag.
- Colour overrides no longer leak across layouts — a custom light background used to follow you into a dark layout.

### Changed

- **Layout menu reworked.** The `Inverted` variant is gone — the palette control covers it, and one-click colour switching inside a layout selector was redundant. New copy variants built on the same JSON-patch architecture: **Powered by** on every layout (including `Powered by nothing` on No sponsors, closing the joke), and **Presented by** on Sponsored by. The menu is now nine items where every entry changes something visible.

- `scripts/cdp-selfcheck.mjs` works on Chrome 132+ again: `--headless=old` was removed upstream, and the initial DevTools target now reports `type: "other"` instead of `"page"`.

### Known gaps

- `palette.accent` is declared by every layout but not yet read by the renderer, so the picker exposes only background and foreground. Wiring accent up means recolouring the headline, which would invalidate `docs/demo.gif`.

## [0.1.0] - 2026-10-25

First public release. Built in six milestones, each with a verifiable acceptance criterion (see [`docs/SPEC.md`](docs/SPEC.md) §9).

### Added

**Rendering**

- `scene(state, t) → SVG` as the single rendering source for preview and every export format.
- Seamless ticker scrolling: the layout at `t = loop` is identical to `t = 0`; multi-row phase offsets and per-row reverse scrolling.
- Layout engine driven by JSON: three layouts (`sponsored-by`, `made-by-gang`, `no-sponsors`) plus four tonal variants applied as RFC 6902 JSON Patches (`made-possible`, `inverted`, `made-by-friends`, `still-no-sponsors`).
- Runtime template validation with errors naming the exact failing path.

**Export**

- GIF export via `modern-gif`: 16 fps, 32 colours, Atkinson dithering, palette sampled from all frames (no inter-frame flicker), infinite loop, 65 of 67 frames automatically cropped to their changed region.
- MP4 export via WebCodecs + `mediabunny`: 30 fps, H.264 (VP9/AV1 fallback), fast-start metadata, keyframe interval equal to the loop length. ~1.3 s for 120 frames at 1080p.
- PNG export with fonts embedded as data URIs, so the file renders identically on a machine without the fonts installed.
- SVG export with CDN font references instead of embedded bytes.
- Platform presets (X, GitHub, Discord, WeChat, Xiaohongshu) with pre-export size estimation compared against each platform's limit.
- Built-in Inter (Latin) plus on-demand Noto Sans SC `unicode-range` slices — a Chinese title typically pulls 3–4 slices (~120 KB) instead of the full 2.4 MB set.

**UI**

- Live preview at 60 fps, bilingual (English / 简体中文), responsive to `prefers-reduced-motion`.
- Layout / variant / language / aspect-ratio / platform selectors.
- Footer shows the canvas size, the platform's playback caveat, and estimated vs. allowed export size.

**Tooling**

- `scripts/cdp-selfcheck.mjs` — zero-dependency Chrome DevTools Protocol driver for the self-check pages.
- `scripts/gif-inspect.mjs` and `scripts/mp4-inspect.mjs` — byte-level container parsers that verify exports independently of the libraries that wrote them.
- Three browser self-check pages (`verify-export`, `verify-gif`, `verify-mp4`) that run the real pipelines and dump machine-checkable evidence.
- 113 unit tests covering the pure parts: scroll math, scene determinism, XML escaping, JSON Patch, template validation, font-slice selection, preset derivation and size model.

### Fixed

- **Ticker dropped items near the loop seam.** The tiling range was hard-coded for `scroll ∈ [0, cycle)`, which only held while the preview was static; once the timeline advanced, `scroll` could span nearly two cycles and visible items on the left were skipped. Caught by a scene-level seamless-loop test, not by looking at the screen.
- **Embedded CJK font never applied.** `"PingFang SC"` was listed before `"Noto Sans SC"` in the font stack, so the system font always won — invisible on the author's machine, but it silently broke cross-device consistency.
- **First frame could export blank.** Fonts embedded inside `<img>` decode asynchronously; the first rasterisation sometimes beat them. `font-display: block` produced an empty title and `swap` silently fell back to a system font without repainting. Rasterisation now checks the title box for ink, retries, and fails loudly on timeout rather than shipping a card with a missing title.
- **Size estimator under-predicted small canvases by 18%.** Area scaling was assumed quadratic; measurement showed a 720² canvas costs 0.52× a 1080² one, not 0.44× (text edges are a larger share of pixels at small sizes). Fitted the exponent to 0.80; prediction error dropped below 1%.
- **MP4 inspector misread frame duration.** `stts` deltas are in the media timescale (`mdhd`), not the movie timescale (`mvhd`); the first version reported absurd per-frame durations. Added `mdhd` parsing.

### Notes

- Emoji are the only icon source in this release. `simple-icons` support and a content editing UI are the next planned additions; `state` already carries text, icons, palette, row count and speed.
- Firefox for Android does not support WebCodecs; the MP4 button is disabled there and GIF remains available.
