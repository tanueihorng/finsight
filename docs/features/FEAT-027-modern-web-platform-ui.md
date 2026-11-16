# FEAT-027 · Modern web platform UI

Deferred proposal, 2026-11-16 SGT. No execution task assigned.
Source: an audit of `public/` and `web/src/` against Google Chrome's
[Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance)
(guides at commit `4dd9683`, 2026-11-10). The guides were read from a clone.
The `legacy-scan` CLI was not run because the sandbox blocked downloading it
with `npx`. The counts below come from grep over 150 UI files, tests excluded.

## Problem

FinSight rebuilds by hand several things the browser now provides:

- **Modals.** Nine modals are `div` elements with `role="dialog"` and
  `aria-modal`: Ledger, Import, Layout, Cash editor, Kestrel limits, Setup,
  Accounts, the trade sheet, and `ui/dialog.tsx`. `ui/modalFocus.ts` adds a
  focus trap. It also makes sibling elements inert, handles Esc and returns
  focus by hand. A `z-index` ladder (200 to 2000, 30 values) keeps the layers
  in order. The guide says native `<dialog>` with `showModal()` gives "inert
  page, focus containment, top layer, `::backdrop`, `Esc`". It says not to
  add a focus trap, inert toggling or an Esc handler.
- **Browser confirm boxes.** `public/journal.js` (3) and `public/chart.js` (2)
  still call `window.confirm`. `ui/dialog.tsx` already replaces this in the
  React code.
- **Menus and popovers.** The Kestrel chat menu, the reply settings, watchlist
  suggestions and the chart flyouts (`pc-fly`, `pc-menu`) each have their own
  outside-click listener and Esc handler. The chart flyouts also position
  themselves with `getBoundingClientRect` and set `style.left` and `style.top`
  in pixels. The guides use the `popover` attribute for light dismiss and the
  top layer, and CSS anchor positioning for placement.
- **Toasts.** There are two toast systems: `.toasts` in `styles.css` and
  `ui/toast.tsx`. Neither uses `popover="manual"` or a named notifications
  region.

## Other findings

1. **Correctness: daily resets use the browser's time zone (reproduced
   2026-11-16 at the maths level).** Under `TZ=Asia/Singapore`, 78 five-minute
   bars for 13 Nov 2026 (09:30 to 16:00 ET) split into two VWAP sessions at
   11:00 ET. The closing VWAP showed 104.750 instead of the session's 103.850.
   `America/New_York` and `Europe/London` gave one session. With live AAPL
   5-minute data over 5 days, the old code also joined each afternoon to the
   next morning: 6 VWAP sessions for 5 trading days.
   **Release 1 implemented 2026-11-16, not yet committed.** Yahoo's
   `exchangeTimezoneName` now reaches the chart as `meta.timeZone`. VWAP,
   pivots and the session profile use `exchangeDay()` in `indicators.js`,
   which handles daylight saving and falls back to UTC. On a live instance in
   SGT, the chart's VWAP reset only at 09:30 ET, once per trading day. VWAP (`indicators.js:118`), intraday pivots
   (`chart.js:156`) and the per-session volume profile (`chart.js:1645`) start
   a new day at midnight in the browser's local time
   (`-new Date().getTimezoneOffset()`). In SGT, the US regular session
   (21:30 to 04:00 SGT, or 22:30 to 05:00 in winter) crosses local midnight.
   VWAP would then reset partway through the session. The day boundary should
   follow the exchange's time zone. Do this first, because accurate tools
   come before new UI.
2. **Light mode.** There is no `<meta name="color-scheme">` and no
   `color-scheme` on `:root`. Instead, `color-scheme` is set on individual
   date inputs. `Trade.module.css:29` always uses `color-scheme: dark`, so
   native controls in the trade sheet probably render dark in light mode.
   `theme-color` is fixed at `#0b0b14`. The light palette is written as
   separate overrides (`[data-mode="light"]`). `light-dark()` would keep each
   pair of colours together.
3. **Text size.** There are 361 `font-size` values in `px` and none in
   `rem`, so the browser's font-size setting has no effect. 92 elements also
   have fixed pixel heights that can clip enlarged text. The guide says
   "DON'T use `px` for font-size". This change affects how dense the terminal
   looks, so it needs a design decision.
4. **Scrollbars.** The scrollbars use `::-webkit-scrollbar`. The standard
   properties are `scrollbar-color` and `scrollbar-width`. Keep the webkit
   rules as a fallback only if the browser target needs them.
5. **Viewport height.** `styles.css:128` uses `min-height: 100vh`. Use `dvh`.
6. **Reduced motion.** The Council CSS turns off every animation inside
   `.board *` with `!important`. The motion guide says to handle reduced
   motion for each component instead of turning everything off at once.
7. **Security.** The server sends only `X-Frame-Options`. It sends no CSP,
   `frame-ancestors` or Trusted Types. `chart.js` and `journal.js` assign
   `innerHTML` 28 times. They escape values with `esc()`, but nothing in the
   browser enforces it. Kestrel's `md.ts` escapes text first and only then
   adds allowed markup, which is sound. Using the browser's `setHTML()` where
   available would add a second check. Safari does not support `setHTML()`.

Already in line with the guides: container queries (15), `:focus-visible`
(55), `tabular-nums`, `inert` on the closed trade sheet, `role="log"` on chat,
`autocomplete` and `inputmode` on inputs, and `Intl` time-zone handling in
Discover, Paper and the briefing.

## Browser support policy (decide first)

Several replacements are not yet supported everywhere. Safari lacks
`closedby` and `setHTML()`, and the guide's data shows anchor positioning in
Safari 27 only. Before starting, add a **Browser Support** line to
`AGENTS.md`. Suggested: *current Chrome and Safari on macOS; Baseline Newly
Available features allowed with feature detection; fallbacks of 20 lines or
fewer and no new dependencies.* This decides whether the popover, anchor
positioning and invoker-command polyfills ship.

## Releases

1. **Correctness.** Use the exchange's time zone for the day boundary in
   VWAP, pivots and the session volume profile. Test with a fixed bar
   sequence that crosses SGT midnight.
2. **Overlays.** Replace the nine modals with `<dialog>` and `showModal()`.
   Name each with `aria-labelledby` and put `autofocus` on the safe action.
   Use `closedby` on purpose for each one. Guard unsaved forms (journal,
   limits) in a `cancel` handler. Add `overscroll-behavior: contain` to
   `dialog:modal` and `::backdrop`. Remove `modalFocus.ts` and most of the
   `z-index` ladder. Send `window.confirm` calls through the shared dialog.
   Rebuild menus, flyouts and suggestions with `popover` and anchor
   positioning, with a fallback chosen by the policy. Merge the two toast
   systems into one `popover="manual"` region and keep the polite live
   region as the announcement fallback.
3. **Theme and text.** Add the color-scheme meta tag and `:root`
   `color-scheme` that follows the mode. Use `light-dark()` tokens and make
   `theme-color` follow the mode. Move scrollbars to the standard properties.
   Replace `100vh` with `dvh`. Rewrite the Council reduced-motion rules. Move
   `font-size` to `rem` only if the user approves the density change.
4. **Hardening.** Add a CSP in report-only mode first, with
   `frame-ancestors 'none'`. Add a Trusted Types policy in report-only mode,
   then move the `innerHTML` assignments to it or to DOM building.

## Acceptance

- After release 1, a fixed AAPL 5-minute series that crosses local midnight
  in `Asia/Singapore` gives one VWAP session per exchange day.
- No `role="dialog"`, `aria-modal`, manual focus trap or `window.confirm`
  remains in UI code. The existing a11y and E2E suites (`H3.a11y`,
  `KESTRELUX`, `PAPER`, `F8`) pass in Chromium and WebKit.
- Esc, light dismiss where enabled, and focus returning to the opener work
  in every modal and menu without app code.
- Light mode shows light native controls (date inputs, trade sheet,
  scrollbars) and a matching browser `theme-color`.
- Before CSP and Trusted Types are enforced, report-only mode shows no
  violations for one full session.

## Not in scope

New features, a visual redesign, a framework change, and the 3,019-line
canvas chart engine apart from its menus and day boundaries.
