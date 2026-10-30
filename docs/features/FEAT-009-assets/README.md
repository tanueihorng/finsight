# FEAT-009 design assets

Everything here is self-contained and works offline. It is the design reference for
[FEAT-009](../FEAT-009-kestrel-terminal-redesign.md). Nothing here is loaded by FinSight itself.

## Contents

| Path | What it is |
|---|---|
| `screens/*.png` | Rendered screenshots of every screen, in dark and light, and in each state |
| `*.dc.html` | The design source: HTML with inline styles, sample data and theme tokens in the `renderVals()` script at the bottom |
| `support.js` | A tiny local runtime that renders the `.dc.html` files in any browser |
| `fonts/` | Local font files and `fonts.css`, so the mockups render exactly as in the screenshots, offline |

## Open a design

Open any `.dc.html` file directly in a browser (`file://` is fine; no server needed). Choose a state with
URL query parameters:

| File | Parameters |
|---|---|
| `MergedStart.dc.html`, `MergedChat.dc.html` | `?theme=terminal` or `?theme=light` |
| `KestrelSide.dc.html` | `?theme=dark\|light&mode=side\|collapsed` |
| `KestrelCards.dc.html` | `?theme=dark\|light&stage=running\|done` |
| `KestrelFull.dc.html` | `?theme=dark\|light` |

The screens are clickable. Each one has a ◐ theme button. The side panel's ASK, ▁ and ⇱ buttons switch
between the side panel and the capsule, and ⤢ links to the full page. On the council pages you can click
a card or lane to focus it, and use the Cards / Chain of thought switch.

The fonts are bundled in `fonts/` (Inter, JetBrains Mono and Source Serif 4, all SIL OFL 1.1 with their LICENSE files) and loaded through `fonts/fonts.css`. Nothing is fetched from the network. They exist only for these mockups; FinSight itself keeps its system font stacks plus Kestrel Serif (FEAT-009 §3.2, §11.2).

## Rules

- **All figures, tickers, sources and costs are invented samples.** Never use them as fixtures that look like real holdings, and never ship them.
- `KestrelFull.dc.html` and the side-panel council show five lenses with typed live reasoning. That goes beyond today's council contract. Build to the data mapping in FEAT-009 §6; the extras are listed in §9.
- `support.js` is for previewing only. Rebuild the screens in React with FinSight's CSS tokens.
