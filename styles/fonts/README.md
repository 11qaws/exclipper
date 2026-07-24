# Bundled fonts

**Pretendard** — SIL Open Font License 1.1.

- Source: https://github.com/orioncactus/pretendard (npm `pretendard@1.3.9`)
- Files: `Pretendard-{Regular,Medium,SemiBold,Bold,ExtraBold}.woff2`
  (static full weights, `dist/web/static/woff2/`)
- License: OFL-1.1 — https://github.com/orioncactus/pretendard/blob/main/LICENSE

Self-hosted rather than loaded from a CDN so the app works offline and under a
strict CSP (no external font host). Covers Korean + Latin in one family, so the
review surface renders the same rhythm whether the analysis language is ko or en.

`@font-face` declarations live in `styles/exclipper-foundation.css`.
