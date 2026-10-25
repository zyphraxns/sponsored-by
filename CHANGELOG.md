# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

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
