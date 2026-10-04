# UX SPEC — AI Virtual Office MVP (Phase 1)

Owner: ui-ux-designer · Task: VO-000 (UX step) · Date: 2026-10-03 · Status: BASELINE v1
Sources: `docs/ORIGINAL_REQUEST.md` (§N), `docs/REQUIREMENTS.md` (REQ-/NFR-/A-), `docs/PM_BRIEF.md` (PM-N).
Stack assumptions (PM-4): React 19 + Tailwind v4 + lucide-react + Inter Variable (`@fontsource-variable/inter`) + Phaser 3.90.
All UI copy is English (Q-1). Strings in `code` or "quotes" in this file are exact UI copy.

Contents: 1 Tokens · 2 Layout & breakpoints · 3 Top bar · 4 Metrics · 5 Virtual office (Phaser) ·
6 Agent roster · 7 Agent detail panel · 8 Activity feed · 9 Developer Simulator · 10 Demo mode ·
11 System states · 12 Shared components · 13 User flows · 14 Accessibility · 15 Formats ·
16 Requirement issues & classified ideas.

---

## 1. Design tokens

All tokens are new (no existing frontend). Define them as CSS custom properties in Tailwind v4 `@theme`
and export the hex values once for Phaser (e.g. `apps/web/src/office/palette.ts`, numbers `0xRRGGBB`).
Contrast ratios below were computed (WCAG 2.x formula) against `panel #13161B` unless stated.

### 1.1 Surfaces, borders, text

| Token | Hex | Use | Contrast note |
|---|---|---|---|
| `--bg` | `#0B0D10` | App background (near-black graphite) | — |
| `--bg-sunken` | `#0E1014` | Inputs, office canvas background + letterbox | muted text 6.13 |
| `--panel` | `#13161B` | Cards, columns, panels | reference surface |
| `--raised` | `#1A1E24` | Raised: dropdowns, hovered cards, secondary buttons | primary 13.63 |
| `--raised-hover` | `#222730` | Hover on raised, tooltip bg | muted 4.83 |
| `--border-subtle` | `#262B33` | Card/panel borders, dividers, progress track | decorative |
| `--border-strong` | `#3A414C` | Input borders, hover borders, button borders | — |
| `--text-primary` | `#E6E8EB` | Primary text, values | 14.77 |
| `--text-secondary` | `#A3AAB5` | Labels, secondary text | 7.75 |
| `--text-muted` | `#8B939E` | Captions, timestamps, placeholders | 5.84 (4.83 on raised-hover) |
| `--accent` | `#5B8DEF` | Focus ring, selected outline, links, active toggles | 5.61 / 6.02 on bg |
| `--accent-text` | `#8AB0FF` | Accent-colored text on dark | 8.40 |
| `--accent-strong` | `#3B6FD9` | Primary button bg (white text 4.71) | — |
| `--accent-strong-hover` | `#335FC0` | Primary button hover (darker = more contrast) | — |
| `--accent-tint` | `#1A2230` | Selected card bg (accent 10% over panel) | primary 13.0 |
| `--overlay-scrim` | `rgba(5,6,8,0.55)` | Scrim (tablet/mobile modal sheets only) | — |

One accent only (`--accent` family). No gradients anywhere except the 1-px skeleton shimmer.

### 1.2 Agent status colors (8)

Text use is AA on `--panel`, on `--raised`, and on the chip tint (status color 16% over panel).
Status is never color-only: every status has an icon and a text label.

| Status | Token | Hex | Chip tint | Label | lucide icon | Canvas glyph |
|---|---|---|---|---|---|---|
| idle | `--st-idle` | `#9AA3AE` | `#292D33` (5.42) | "Idle" | `Circle` | hollow circle |
| planning | `--st-planning` | `#4FB6E0` | `#1D303B` (5.92) | "Planning" | `CircleEllipsis` | circle + 3 dots |
| working | `--st-working` | `#3FB950` | `#1A3023` (5.54) | "Working" | `Activity` | pulse polyline |
| waiting | `--st-waiting` | `#D9A13B` | `#332C20` (5.99) | "Waiting" | `CirclePause` | circle + 2 bars |
| reviewing | `--st-reviewing` | `#A98AF5` | `#2B293E` (5.13) | "Reviewing" | `Search` | magnifier |
| completed | `--st-completed` | `#4CC38A` | `#1C322D` (6.14) | "Completed" | `CircleCheck` | circle + check |
| failed | `--st-failed` | `#F2645A` | `#372225` (4.76) | "Failed" | `TriangleAlert` | triangle + "!" |
| offline | `--st-offline` | `#8A929D` | `#262A30` (4.59) | "Offline" | `PowerOff` | power symbol |

Working (pure green) and completed (mint) differ in hue, icon and animation. Chip border = status
color at 40% alpha.

Severity (feed, logs, banners) reuses status hues: info = `--text-muted` (no icon), warning =
`--st-waiting` + `TriangleAlert`, error = `--st-failed` + `CircleX`. Banner tints: warning
`#2F291F`, error `#322124` (primary text on both ≥ 11.7).

### 1.3 Task status and priority display

| Task status | Label | Color token | Icon |
|---|---|---|---|
| todo | "To do" | `--st-idle` | `Circle` |
| assigned | "Assigned" | `--st-planning` | `CircleDot` |
| planning | "Planning" | `--st-planning` | `CircleEllipsis` |
| in_progress | "In progress" | `--st-working` | `Activity` |
| waiting | "Waiting" | `--st-waiting` | `CirclePause` |
| review | "In review" | `--st-reviewing` | `Search` |
| completed | "Completed" | `--st-completed` | `CircleCheck` |
| failed | "Failed" | `--st-failed` | `TriangleAlert` |
| cancelled | "Cancelled" | `--st-offline` | `CircleX` |

| Priority | Label | Color | Icon |
|---|---|---|---|
| low | "Low" | `--text-muted` | `ChevronDown` |
| normal | "Normal" | `--text-secondary` | `Minus` |
| high | "High" | `--prio-high #E08A4F` (6.84) | `ChevronUp` |
| critical | "Critical" | `--st-failed` | `ChevronsUp` |

### 1.4 Department colors (muted; identity only, never a status signal)

Used for: room header accent bar, character torso in the office, avatar ring/background.
Avatar background = dept color 28% over panel; initials in `--text-primary` (≥ 9.27).

| roomId | Label | Token | Hex | Avatar bg |
|---|---|---|---|---|
| `management` | Management | `--dept-management` | `#7C8BC9` | `#30374C` |
| `development` | Development | `--dept-development` | `#5E9E94` | `#283C3D` |
| `design` | Design | `--dept-design` | `#B57F9F` | `#403340` |
| `infrastructure` | Infrastructure | `--dept-infrastructure` | `#8A9A5B` | `#343B2D` |
| `quality` | Quality | `--dept-quality` | `#B98B63` | `#41372F` |
| `ai-lab` | AI Lab | `--dept-ai-lab` | `#9583C9` | `#37354C` |
| `documentation` | Documentation | `--dept-documentation` | `#7F97A8` | `#313A42` |
| `audit` | Audit | `--dept-audit` | `#A39580` | `#3B3A37` |

### 1.5 Typography

Family: `"Inter Variable", system-ui, sans-serif`. Mono (task ids, actions, logs, hashes):
`ui-monospace, "Cascadia Mono", Consolas, monospace` (system stack — no extra font download).
`font-variant-numeric: tabular-nums` on: metric values, clock, all timestamps, durations, progress %,
counts. Font feature `"cv11"` (single-storey a) optional.

| Token | Size / line | Weight | Use |
|---|---|---|---|
| `text-caption` | 11 / 16 | 600, `letter-spacing .06em`, uppercase | Section eyebrows, DEMO badge, room labels (HTML) |
| `text-xs` | 12 / 16 | 400–500 | Meta, timestamps, chips, field labels |
| `text-sm` | 13 / 20 | 400–600 | Default dense UI text, buttons, inputs, feed messages |
| `text-base` | 14 / 20 | 400–600 | Panel field values, empty-state body |
| `text-title-sm` | 16 / 24 | 600 | Section / card titles, empty-state titles |
| `text-title` | 18 / 26 | 600 | Detail panel agent name |
| `text-metric` | 24 / 28 | 600, tabular | Metric values |
| `text-brand` | 15 / 20 | 600, `letter-spacing -.01em` | "AI Virtual Office" |

Weights used: 400, 500, 600 only.

### 1.6 Spacing, radius, elevation, motion

- Spacing scale (px): `0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48`. Page gutter 16; column gap 12;
  card padding 12 (metrics 12×14); panel padding 16.
- Radius: `--r-sm 4` (tags, progress bars), `--r-md 6` (buttons, inputs, chips are full-pill
  `999`), `--r-lg 8` (cards, panels, office card, dock), `--r-full 999` (pills, avatars, switch).
- Elevation: cards have **no shadow** (border only). Overlays (detail panel overlay, dropdowns,
  tooltip, toast): `0 8px 24px rgba(0,0,0,.45)` + 1 px `--border-subtle`. Nothing else.
- Motion tokens: `--dur-fast 120ms`, `--dur-base 180ms`, `--dur-slow 240ms`;
  `--ease-standard cubic-bezier(.2,0,0,1)`, `--ease-exit cubic-bezier(.4,0,1,1)`.
  Under `prefers-reduced-motion: reduce`: all CSS transitions ≤ 1 ms except opacity ≤ 120 ms; no
  transforms, no shimmer, no spinner rotation (static icon + text).
- Focus ring: `outline: 2px solid var(--accent); outline-offset: 2px` on `:focus-visible` only.

---

## 2. Layout and breakpoints

### 2.1 Breakpoints

| Name | Viewport width | Mode |
|---|---|---|
| `mobile` | < 768 | Simplified monitoring view, no Phaser instance (§2.6) |
| `tablet` | 768–1023 | Page scroll, single column office, two-column roster/feed (§2.5) |
| `laptop` | 1024–1279 | Page scroll like tablet, top bar single row with compact labels |
| `desktop` | 1280–1599 | **Viewport-locked control-room shell**, right column 320 (<1440) / 360 (≥1440) |
| `wide` | 1600–1759 | Desktop shell, right column 400 |
| `ultra` | ≥ 1760 | Desktop shell, detail panel **docks** as its own column (400) and feed is 360 |

Reference viewports are CSS inner sizes after browser chrome: 1440×900 screen ≈ **1440×790**,
1920×1080 ≈ **1920×970**, 1366×768 ≈ **1366×657**. No horizontal page scroll at any width (NFR-005).

### 2.2 Desktop shell (≥ 1280) — viewport-locked

`.shell { height: 100vh; min-height: 640px; display: grid; grid-template-rows: 56px auto 1fr; }`
Body never scrolls at ≥ 640 px height; each column scrolls internally. Gutter 16, gaps 12.

```
row 1  Top bar (56, full width, border-bottom subtle)
row 2  Metrics row (64, full width, 8 equal cards)
row 3  [ Main column (1fr) ]  [ Right column: Live activity (360) ]      <- default
       [ Main column (1fr) ]  [ Detail panel (400) ] [ Feed (360) ]       <- ultra + panel open
Main column (scroll container): Office card -> Agents roster -> (Simulator dock, sticky bottom)
```

**Office height formula** (recomputed on resize, simulator toggle and panel dock change; debounce 100 ms):
```
rowH       = max(innerHeight, 640) - 156            // 56 top bar + 12 + 64 metrics + 12 + 12 bottom
peek       = rowH >= 600 ? 140 : 64                 // keeps roster header (+1 row) visible
canvasMaxH = simulatorOpen ? rowH - 32 - 12 - 200   // 32 office header, 12 gap, 200 dock
                           : rowH - 32 - peek
canvasH    = max(220, min(mainW * 540/1140, canvasMaxH, 540 * 1.6))
zoom       = min(mainW / 1140, canvasH / 540, 1.6)  // world 1140×540, see §5
LOD        = zoom < 0.70 ? "compact" : "full"
```
Canvas fills `mainW × canvasH`; the world is centered; letterbox uses `--bg-sunken` so it is invisible.

| Viewport | Right col | Main W | Office zoom (sim closed / open) | LOD |
|---|---|---|---|---|
| 1920×970 | 400 | 1476 | 1.19 / 1.06 | full |
| 1920×970, panel docked | 400 + 360 | 1104 | 0.97 / 0.97 | full |
| 1440×790 | 360 | 1036 | 0.86 / 0.72 | full |
| 1366×657 | 320 | 1002 | 0.75 / 0.48 | full / compact |
| 2560×1330 | 400 | 2116 | 1.60 / 1.60 | full |

### 2.3 Wireframe — 1440×900 (viewport 1440×790), simulator closed, panel closed

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ [■] AI Virtual Office  (● Operational)  [▤ All Projects ▾]        Demo mode (o─)  [⚗ Simulator]  ⚇ 12/15 online  (◉ Connected)  22:41:07 │ 56
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│┌Agents Online┐┌Working  ⌁ ┐┌Planning ◌ ┐┌Waiting  ‖ ┐┌Reviewing ⌕┐┌Failed  ▲ ┐┌Active Tasks┐┌Completed  ✓┐│ 64
││ 12          ││ 4          ││ 2          ││ 1          ││ 2          ││ 1         ││ 7           ││ 3           ││
│└─────────────┘└────────────┘└────────────┘└────────────┘└────────────┘└───────────┘└─────────────┘└─────────────┘│
│┌ OFFICE ─────────────────────── legend: ○Idle ◌Planning ⌁Working ‖Waiting ⌕Reviewing ✓Completed ▲Failed ⏻Offline ┐┌ LIVE ACTIVITY ───── [Hide demo] [All ▾]┐│
││                                                                                  ││ ── Today ──                            ││
││   ┌ MANAGEMENT ─ 2 active ──┐ ┌ DEVELOPMENT ─ 3 active ─────────┐ ┌ DESIGN ┐       ││ 22:41:07 (BE) Backend Engineer [Sellway]││
││   │ [desk] [desk] [desk]    │ │ [desk] [desk] [desk] [desk]     │ │ [desk] │       ││  run_command — Running backend tests    ││
││   │  PM    Analyst Architect│ │ Backend Frontend Database Mobile│ │ UI/UX  │       ││ 22:41:02 (QA) QA Engineer   [Sellway]   ││
││   └─────────────────────────┘ └─────────────────────────────────┘ └────────┘       ││  Status → ‖ Waiting  Waiting for Backend││
││   ┌ INFRASTRUCTURE ┐┌ QUALITY ───┐┌ AI LAB ┐┌ DOCUMENTATION ┐┌ AUDIT ┐             ││ ▲ 22:40:51 (SYS) System                 ││
││   │ [desk] [desk]  ││[desk][desk]││ [desk] ││   [desk]      ││[desk] │             ││  Warning — Demo snapshot is 2 h old     ││
││   │ DevOps Security││ QA Reviewer││  AI    ││   Docs        ││Auditor│             ││ …                                       ││
││   └────────────────┘└────────────┘└────────┘└───────────────┘└───────┘  (canvas 1036×462, zoom 0.86) ││                                        ││
│├ AGENTS 15 · 12 online ──────────────────────────────────────────────────────────┤│                                        ││
││ [card][card][card][card][card]   (5 columns, 3 rows, scrolls inside main column) ││                                        ││
│└──────────────────────────────────────────────────────────────────────────────────┘└────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
  main column 1036                                                                    right column 360
```

### 2.4 Wireframe — 1920×1080 (viewport 1920×970), simulator open, panel docked (ultra)

```
┌─Top bar (56)─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
├─Metrics: 8 cards × ~228 (64)─────────────────────────────────────────────────────────────────────────────────────────────┤
│┌ Main 1104 ───────────────────────────────────────────┐┌ Agent detail 400 ───────────┐┌ Live activity 360 ───────────┐│
││ OFFICE header (32) + legend                            ││ (BE) Backend Engineer   [X] ││ ── Today ──                   ││
││ canvas 1104×523, zoom 0.97                             ││ Backend Engineer·Development││ 22:41:07 Backend Engineer …   ││
││                                                        ││ [⌁ Working]                 ││ 22:41:02 QA Engineer …        ││
││                                                        ││ Fields grid (2 cols)        ││                               ││
││                                                        ││ [Activity|Tasks|Logs|Files|Git]                             ││
│├ AGENTS roster (scrolls under the dock) ────────────────┤│ tab content (scrolls)       ││                               ││
│╞ DEVELOPER SIMULATOR dock (200, sticky bottom) ════════╡│                             ││                               ││
││ Target | Status actions | Send activity                ││                             ││                               ││
│└────────────────────────────────────────────────────────┘└─────────────────────────────┘└───────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
At 1920 this shows metrics, office, detail panel, feed and simulator simultaneously — the §32 /
REQ-191 verification view.

### 2.5 Detail panel placement (desktop)

- `desktop`/`wide` (< 1760): panel is a **non-modal overlay with exactly the right column's bounds**
  (same top/bottom/width as the feed column, 360 or 400; 320 at < 1440 grows to 360 and overlaps
  the main column by 40 px). It covers the feed while open; office, metrics and simulator stay
  visible and usable. No scrim. Enter: `translateX(16px)→0` + opacity 0→1, 220 ms `--ease-standard`;
  exit 160 ms `--ease-exit`.
- `ultra` (≥ 1760): panel **docks** as a grid column (400) between main and feed; main shrinks and
  the office re-zooms. No overlap.

### 2.6 Tablet and laptop (768–1279) — page scroll

```
┌ Top bar: row 1 (56) name · system pill · connection · clock │ row 2 (44, only < 1024) project · demo · sim · agents ┐
├ Metrics 4 × 2 grid (2 rows × 64) ──────────────────────────────────────────────────────────────────────────────────┤
├ Office card, full width, height = width × 540/1140 (+32 header); 768 → zoom 0.65 compact, 1024 → 0.87 full ───────┤
├ [ Agents roster (50%) ] [ Live activity (50%) ]  each max-height 640, internal scroll; < 900 px: roster 1 col ──────┤
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
- Top bar 1024–1279: single row, "Simulator" becomes icon-only (`aria-label="Developer Simulator"`),
  "Demo mode" label becomes "Demo", agents count shows `12/15`.
- Detail panel: **modal** right sheet `width: min(440px, 100vw - 48px)`, full height, scrim
  `--overlay-scrim`, focus trapped, scrim click closes.
- Simulator: **non-modal bottom sheet**, height `min(50vh, 420px)`, sections stacked vertically
  (Target → Status actions 2-column grid → Send activity), internal scroll; the page gets
  `padding-bottom` = sheet height so every section can still be scrolled into view above it.

### 2.7 Mobile (< 768) — simplified monitoring view

```
┌ AI Virtual Office          (◉ Connected) [⋯] ┐ 52   [⋯] menu: Demo mode switch · Developer Simulator ·
├ [▤ All Projects                          ▾]  ┤ 44         Agents online 12/15 · System: Operational · clock
├ Online 12 │ Working 4 │ Planning 2 │ Waiting 1 ┤ metrics 4 × 2 tiles (value 20 px, label 11 px, may wrap)
├ Review 2  │ Failed 1  │ Active 7   │ Done 3    ┤ (mobile-only short labels: "Online", "Review", "Active", "Done")
├ [ Agents (15) | Activity ]  segmented tabs    ┤
│ roster cards 1 column / feed rows             │
│ note card: "Office view is available on screens 768 px and wider."  (top of Agents tab, dismissible) │
└───────────────────────────────────────────────┘
```
- No Phaser game is created below 768 px; crossing the breakpoint mounts/destroys the single
  instance (debounce 200 ms, REQ-075).
- Detail panel = full-screen sheet with "Back" (`ArrowLeft`) + X. Simulator = full-screen sheet.
- Connection pill on mobile shows the worse of system/connection state (e.g. "Backend unavailable").

---

## 3. Top bar (56 px, `--panel`, bottom border subtle)

Order left → right. Every control has an action; nothing is decorative except the logo.

| # | Element | Spec | Action |
|---|---|---|---|
| 1 | Logo mark | 20×20, 2×2 grid of rounded squares, `--accent` + `--border-strong` | none (not focusable) |
| 2 | Product name | "AI Virtual Office", `text-brand` | none |
| 3 | DEMO badge | Only while demo runs: "DEMO", `text-caption`, `--accent-text` on `--accent-tint`, 1 px accent border, pill, 6 px dot pulsing opacity 1↔.4 / 2 s (static under reduced motion) | none; `aria-label="Demo mode is running"` |
| 4 | System status pill | dot + text: "Operational" (`--st-working`), "Degraded" (`--st-waiting`), "Backend unavailable" (`--st-failed`), "Checking…" (`--st-idle`, initial) | none; tooltip explains rule (§11.1) |
| 5 | Project selector | 220 px button `▤` (`FolderKanban`) + current value + `ChevronDown`; listbox options "All Projects", "Sellway", "Ishkun24", "ERP", "Ana Market". When ≠ All: accent border + inline clear `X` button `aria-label="Clear project filter"` | sets filter; URL `?project=<id>` (REQ-061); `replaceState` |
| — | flexible spacer | | |
| 6 | Demo mode switch | label "Demo mode" + switch (32×18). Pending: thumb shows 12 px spinner, label "Starting…" / "Stopping…", disabled | start/stop via API (§10) |
| 7 | Simulator toggle | secondary button `FlaskConical` + "Simulator", `aria-pressed`, pressed = accent-tint bg + accent border | open/close simulator dock; focus → Agent select on open |
| 8 | Agents online | `Users` icon + "12/15 online" (global, never filtered, REQ-060) | none; `aria-label="12 of 15 agents online"` |
| 9 | Connection pill | `role="status" aria-live="polite"`; see §11.2 | "Reconnect" lives in the banner, not the pill |
| 10 | Clock | "22:41:07" (24 h local, ticks each second, tabular, `text-sm` 500); `<time>` with `title="Saturday, 3 October 2026 · <IANA zone>"`; not live-announced | none |

---

## 4. Metrics row

8 equal cards in one row (desktop), 4×2 (tablet/laptop), 4×2 tiles (mobile). Non-interactive
(no hover, not focusable). Semantic markup: one `<dl>`; each card = `<div><dt>label</dt><dd>value</dd></div>`.

```
┌──────────────────────┐  64 px; padding 10×14; --panel, border subtle, r-lg
│ Working          ⌁   │  label text-xs 500 --text-secondary; icon 16 in status color (aria-hidden)
│ 4                    │  value text-metric --text-primary, tabular
└──────────────────────┘
```

| Card | Label | Icon (color) | Value |
|---|---|---|---|
| 1 | "Agents Online" | `Users` (`--text-secondary`) | agents `online=true` |
| 2 | "Working" | `Activity` (working) | status working |
| 3 | "Planning" | `CircleEllipsis` (planning) | status planning |
| 4 | "Waiting" | `CirclePause` (waiting) | status waiting |
| 5 | "Reviewing" | `Search` (reviewing) | status reviewing |
| 6 | "Failed" | `TriangleAlert` (failed) | status failed; value text `--st-failed` when > 0 |
| 7 | "Active Tasks" | `ListTodo` (`--text-secondary`) | tasks assigned/planning/in_progress/waiting/review (A-06) |
| 8 | "Completed Tasks" | `CircleCheck` (completed) | tasks completed |

- Filter: counts follow REQ-062 (agents with `currentProject = P`, tasks with `project = P`). The
  filter context is shown only in the top bar selector (no per-card caption).
- Value change: number swaps instantly; card border flashes `--border-strong`→subtle over 600 ms
  (none under reduced motion).
- Loading: value replaced by skeleton bar 40×22. Stale (backend unavailable): values at
  `--text-muted`; row has `aria-describedby` → banner text.

---

## 5. Virtual office (Phaser 3)

### 5.1 Container and scaling

- Office card: `--panel`, border subtle, r-lg. Header 32 px: eyebrow "OFFICE" (`text-caption`,
  secondary) + right-aligned legend of 8 statuses (icon 12 + label `text-xs` muted, gap 12; at
  main width < 1100 legend shows icons only with `title`). Below: canvas host.
- One `Phaser.Game` per page (REQ-075), `Scale.RESIZE` sized to the host; scene computes camera
  zoom per §2.2 and centers the world. Canvas backing store = CSS size × `devicePixelRatio`
  (cap 2); `Text.setResolution(min(2, dpr) × max(1, zoom))` so labels stay crisp.
- Host markup: `<div role="img" aria-label="…">` wrapping the canvas; canvas `tabindex="-1"`.
  Label text (updated, debounced 2 s): "Virtual office floor plan: 15 agents in 8 rooms. 4 working,
  2 planning, 1 waiting, 2 reviewing, 1 failed, 3 offline. Use the Agents list to inspect or open
  an agent." A visually-hidden link "Skip to agents list" precedes the host.

### 5.2 World and floor plan — 1140 × 540 logical px

Background (outside rooms, corridors) `--bg-sunken #0E1014`. Margins 16, corridors 12.
Desk slot = **116 × 200**; slot gap 12; room padding 16; room header 32.
Room: floor `#15181D`, 1 px border `--border-subtle`, radius 6; floor tile grid every 24 px,
1 px lines `#FFFFFF` at 2.5% alpha (the "pixel-office" influence). Header: 3×12 px dept-color bar at
(x+12, y+10), label at (x+22, y+9) uppercase 13 px 600 letter-spacing 1.2 px `--text-secondary`,
right-aligned "N active" 12 px `--text-muted` (count of agents in planning/working/waiting/reviewing
in the room, respecting the project filter; hidden if 0).

```
x→ 16                         428 440                           956 968      1124
 16 ┌ MANAGEMENT ──────────────┐ ┌ DEVELOPMENT ──────────────────┐ ┌ DESIGN ┐
    │  [01 PM][02 PA][03 ARC]  │ │ [04 BE][05 FE][06 DBE][11 MOB]│ │ [10 UX]│      row 1: y 16–264
264 └──────────────────────────┘ └───────────────────────────────┘ └────────┘
276 ┌ INFRASTRUCTURE ┐ ┌ QUALITY ───────┐ ┌ AI LAB ┐ ┌ DOCUMENTATION ┐ ┌ AUDIT ┐
    │ [07 OPS][08 SEC]│ │ [09 QA][14 REV]│ │[12 AIE]│ │   [13 DOC]    │ │[15 AUD]│   row 2: y 276–524
524 └────────────────┘ └────────────────┘ └────────┘ └───────────────┘ └───────┘
```

| Room (roomId) | x | y | w | h | Desks (deskId → agent) | Slot top-left (x, y) |
|---|---|---|---|---|---|---|
| Management (`management`) | 16 | 16 | 412 | 248 | `management-1` PM · `-2` PA · `-3` ARC | (36,56) (164,56) (292,56) |
| Development (`development`) | 440 | 16 | 516 | 248 | `development-1` BE · `-2` FE · `-3` DBE · `-4` MOB | (448,56) (576,56) (704,56) (832,56) |
| Design (`design`) | 968 | 16 | 156 | 248 | `design-1` UX | (988,56) |
| Infrastructure (`infrastructure`) | 16 | 276 | 280 | 248 | `infrastructure-1` OPS · `-2` SEC | (34,316) (162,316) |
| Quality (`quality`) | 308 | 276 | 280 | 248 | `quality-1` QA · `-2` REV | (326,316) (454,316) |
| AI Lab (`ai-lab`) | 600 | 276 | 168 | 248 | `ai-lab-1` AIE | (626,316) |
| Documentation (`documentation`) | 780 | 276 | 168 | 248 | `documentation-1` DOC | (806,316) |
| Audit (`audit`) | 960 | 276 | 164 | 248 | `audit-1` AUD | (984,316) |

Slots are horizontally centered in each room: `startX = room.x + (room.w − (n·116 + (n−1)·12)) / 2`;
`slot.y = room.y + 40`. The desk-slot table is the canonical seed for `deskId` positions (the
architect may move it to shared constants; the numbers must not drift).

### 5.3 Workstation drawing (slot-local coords, 116 × 200; integer coords, no gradients)

Drawing order (back → front): hover/selection plate → glow → monitor → desk → character → chair
back → badges/bubble → name label → status chip. The character is seen **from behind**, facing the
monitor, so the screen state is visible.

```
   0        58        116
 0 ┌─────────────────────┐
   │      ┌────────┐ (B) │  B = status badge anchor (88, 26), r 9
26 │      │ screen │     │  monitor bezel 68×46 at (24,26), fill #1F232A, 1px #3A414C, r 3
   │      │  ≡≡≡   │     │  screen inset 3 px (62×40), fill per status (§5.4)
72 │      └──┬──┬──┘     │  stand 8×8 at (54,72), base 24×3 at (46,79): #2A2F37
82 │ ┌─────────────────┐ │  desk top 100×18 at (8,82) #2A2F37, r 3; front edge 100×4 at (8,100) #20242B
   │ └─────(  )────────┘ │  head: circle r 11 at (58,98), fill #3A3F48, 1px #4A505A (back of head)
   │      ╭─────╮   (…)  │  torso: 40×24 at (38,106), r 6, dept color @ 90% (offline: #3A3F47)
   │     ┌┴─────┴┐       │  chair back: 46×28 at (35,118), r 6, #1C2026, 1px #2A2F37 (covers lower torso)
146│     └───────┘       │  thought bubble anchor (84,92) — planning only (§5.4)
158│      Backend        │  name label: shortRole, 15 px 600 --text-primary, centered at (58,158)
178│    [⌁ Working]      │  status chip: h 20 at y 178, centered (§5.5)
200└─────────────────────┘
```

- Name label text = `shortRole` (max 12 chars; ellipsize beyond). Full name is in the tooltip,
  roster and panel. All text set via Phaser `Text` with plain strings (REQ-163).
- Click/hover target = whole slot rect (116×200 world; ≥ 55×95 CSS px at zoom 0.48) — use
  `setInteractive(new Rectangle(0,0,116,200))`, `useHandCursor`.

### 5.4 Status visuals and animations

Screen "lines" = 2–3 rounded bars (h 3, r 1.5) at screen-local y 8 / 16 / 24, x 6.
Durations in ms; Phaser ease names. "Loop" = `repeat: -1`. All loops are created on entering the
status and destroyed on leaving it (no orphan tweens).

| Status | Screen | Indicator / badge | Character | Animation (normal motion) | Reduced motion |
|---|---|---|---|---|---|
| idle | `#161B22`, 2 static bars `#2A313B` | none | normal | none | same |
| planning | `#121C24`, 2 bars planning @ 35% | thought bubble 30×18 r 9 at (84,92), fill `--raised-hover`, 1 px planning; tail circles r3 (80,108), r2 (76,113); 3 dots r 2.5 planning, spacing 7 | normal | bubble in: scale .8→1, 160, `Cubic.easeOut`. Dots: alpha .25→1, 400, `Sine.easeInOut`, yoyo, loop, repeatDelay 400, delay i·200 (1.2 s cycle) | dots static alpha 1 |
| working | `#0F1F16`, 3 typing bars working @ 85% | glow rect (monitor +8 px, r 6) working; mini badge none (chip only) | normal | Glow alpha .08↔.22, 1200, `Sine.easeInOut`, yoyo, loop. Typing: each bar width 6→rand(20..52), 700, `Stepped` (6 steps), hold 300, snap to 6, loop, stagger 250 | glow static .18; bars static widths 44/30/38 |
| waiting | `#1F1A0F`, 2 bars waiting @ 30% | badge r 9 waiting fill, two 2×8 dark bars (`#0B0D10`) | normal | badge in: scale .6→1, 200, `Back.easeOut`; no loop ("paused") | no scale-in |
| reviewing | `#1A1526`, 3 doc bars reviewing @ 35% | badge r 9 reviewing fill, magnifier glyph dark | normal | scan line (62×1, reviewing @ 70%) y screen-top+4 ↔ bottom−4, 1800, `Sine.easeInOut`, yoyo, loop | scan line static at mid-screen |
| completed | `#10201A`, check glyph 14 px completed @ 60% | badge r 9 completed fill, check glyph dark | normal | **Only on a live transition into completed:** badge scale 0→1.15 (200, `Back.easeOut`)→1 (120); ring stroke r 10→28, alpha .6→0, 600, `Cubic.easeOut`; screen tint .25→.08, 600; slot outline 1 px completed alpha .6→0 over 3000, `Sine.easeOut`. At t = 3000: badge scale 1→.85 (200) = calm settled state. Initial load renders the settled state | settled state immediately |
| failed | `#2A1214`, 2 bars failed @ 60% | badge r 9 failed fill, triangle-"!" glyph dark; slot outline 1 px failed @ 50% (static) | normal | badge alpha 1↔.6 and scale 1↔1.08, 1000, `Sine.easeInOut`, yoyo, loop (2 s cycle) | static badge, alpha 1 |
| offline | `#08090B` (off), no bars, no glow | none | torso `#3A3F47`, head `#2A2E35` | workstation container alpha →.35, 300, `Cubic.easeOut` | instant |

Generic status change: old indicator fades out 120 ms, new fades in 180 ms (`Cubic.easeOut`), chip
updates at the crossfade midpoint. Visual reflects the broadcast within 1 s; the scene is never
re-created for a status change (REQ-072). When the document is hidden Phaser pauses (default).
While "Backend unavailable" all scene tweens are paused (`tweens.pauseAll()`) and resumed on recovery.

### 5.5 Status chip in canvas

- Full LOD (zoom ≥ 0.70): pill h 20, r 10, padding 8, min width 72; fill = chip tint (§1.2), 1 px
  status color @ 40%; glyph 10 px + 4 gap + label 12 px 600 in status color.
- Compact LOD (zoom < 0.70): 20×20 circle with glyph only (status still distinguishable by glyph +
  color); name label stays. Full text is available in tooltip, roster and panel.

### 5.6 Hover, selected, filter-dimmed

| State | Visual |
|---|---|
| Hover | Plate: slot rect inset 2, r 6, fill `#FFFFFF` @ 4%, 1 px `--border-strong`; cursor pointer; HTML tooltip after 250 ms |
| Selected (panel open for this agent) | Plate fill `--accent` @ 8%, 2 px `--accent` outline r 6 (persists while panel open; overrides hover) |
| Dimmed (project filter, agent's `currentProject ≠ P`) | Container alpha .40 (offline + dimmed: .25), tween 200 ms; still hoverable and clickable (REQ-062) |

**Tooltip** (HTML layer absolutely positioned over the canvas; the scene emits world→screen
coordinates): `--raised-hover`, 1 px subtle, r 6, shadow overlay, max-width 260, padding 8×10,
placed 8 px above the slot (flips below if clipped). Content:
line 1 name (`text-sm` 600) · line 2 status chip (sm) + project · line 3 current action (mono 12)
+ " — " + last message truncated to 80 chars · line 4 "Click to open details" (`text-xs` muted).
Hidden on pointer leave (0 ms) and on scroll/zoom change.

**Click**: opens the detail panel for that agent (or swaps it if open). Click on empty floor
closes the panel (§7.6).

---

## 6. Agent roster

Header (32): "AGENTS" eyebrow + "15" + "· 12 online" (`text-xs` muted). Grid columns by main-column
width: ≥ 1000 → 5; 760–999 → 4; 560–759 → 3; 360–559 → 2; < 360 → 1. Gap 12. Order = office
reading order (01, 02, 03, 04, 05, 06, 11, 10, 07, 08, 09, 14, 12, 13, 15). With a filter: agents
on P first (same relative order), rest dimmed (opacity .45). If none on P: note row above the grid
`Info` icon + "No agents on Sellway" (`text-sm` secondary).

```
┌────────────────────────────────┐  88 px, padding 10×12, --panel, 1px subtle, r-lg, <button>
│ (BE)  Backend Engineer         │  avatar 28 (code initials, dept bg + 1px dept ring); name text-sm 600, ellipsis
│       ⌁ Working · Sellway      │  status icon 14 + label text-xs 600 (status color) · project text-xs secondary
│       SW-123 · Lost Goods… 40% │  task id mono 12 muted · title text-xs muted ellipsis · % tabular right
│ ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬░░░░░░░░░░░░░ │  progress bar 3 px (track subtle, fill status color) only if progress > 0 and active/completed
└────────────────────────────────┘
```
- No task: line 3 = "No active task" (`text-xs` muted). No project: "No project".
- States: hover (`--raised`, border strong); focus-visible ring; selected (`--accent-tint` bg,
  1 px accent border, `aria-current="true"`); dimmed (.45); offline (avatar grayscale, name
  `--text-secondary`); live change → border flashes `--border-strong` 600 ms.
- `aria-label`: "Backend Engineer, Working, project Sellway, task SW-123 Lost Goods API, 40 percent.
  Open details." Enter/Space opens the panel.
- Loading: 15 skeleton cards. Error (agents fetch failed): replaces grid with error state §11.4.

---

## 7. Agent detail panel

### 7.1 Structure

`role="dialog" aria-modal="false"` (desktop) / `"true"` (tablet, mobile), `aria-labelledby` = name
heading. URL reflects open agent: `?agent=04-backend-engineer` (with `project`), `replaceState`.

```
┌ header (sticky, 72) ───────────────────────────────┐
│ (BE)40  Backend Engineer                       [X] │  name text-title; X = ghost icon button 32, aria-label "Close agent details"
│         Backend Engineer · Development             │  role · department (text-sm secondary)
│         [⌁ Working]                                │  status chip md (h 24)
├ fields grid (2 columns, row gap 12, col gap 16) ───┤
│ CURRENT PROJECT        CURRENT TASK                │  labels text-xs 500 muted (sentence case: "Current project")
│ Sellway                Lost Goods API              │  values text-base primary; null → "—"
│ TASK ID                PROGRESS                    │
│ SW-123 (mono)          ▬▬▬▬▬▬░░░░ 40%              │  bar 6 px, status color fill, role=progressbar
│ STARTED AT             RUNNING DURATION            │
│ 22:37:55               00:03:12 (ticks 1 s)        │  duration only while active; else "—"
│ CURRENT ACTION (full width)                        │
│ run_command (mono)                                 │
│ LAST ACTIVITY (full width)                         │
│ 12s ago · 22:41:07                                 │
│ LAST MESSAGE (full width)                          │
│ Running backend tests  (plain text, 6-line clamp + "Show more"/"Show less") │
├ tabs (sticky under header when scrolled) ──────────┤
│ Activity  Tasks 3  Logs  Files  Git                │  underline tabs, text-sm 500; active = primary + 2px accent underline
├ tab panel (scrolls with panel body) ───────────────┤
└────────────────────────────────────────────────────┘
```
Widths: 360/400 (desktop overlay/dock), `min(440, 100vw − 48)` tablet, 100% mobile. Padding 16.
Field values that change while open flash `--accent-tint` background for 800 ms.

### 7.2 Field rules (REQ-081)

| Field | Source | Format |
|---|---|---|
| Name / role / department | agent | as stored |
| Status | agent.status | chip md (icon + label) |
| Current project | agent.currentProject → project name | "—" if null |
| Current task | agent.currentTask | wraps up to 2 lines |
| Task ID | agent.taskId | mono |
| Progress | agent.progress | bar + "40%"; "—" if no task |
| Started at | agent.startedAt | §15 absolute |
| Running duration | now − startedAt while status ∈ active | "HH:MM:SS", ≥ 24 h "1d 02:04:12"; else "—" |
| Current action | agent.currentAction | mono |
| Last activity | agent.lastActivityAt | "12s ago · 22:41:07" (relative recomputed each second) |
| Last message | agent.lastMessage | plain text |

### 7.3 Tabs (`role="tablist"`, arrow keys move, Home/End, automatic activation)

| Tab | Data | Row anatomy | Empty state | Label |
|---|---|---|---|---|
| **Activity** (default, real) | `GET /api/events?agentId=…&limit=50` + live prepend; ignores project filter (A-10) | time (tabular, muted) · event label (§8.3) · project tag · message (plain, 2-line clamp); severity icon for warning/error | Title "No activity yet" · body "Events from this agent will appear here in real time." | — |
| **Tasks** (real) | `GET /api/tasks?agentId=…` + live | task status chip sm · id (mono) · title (`text-sm` primary) / project tag · priority (icon+label) · progress bar 64 px + % | Title "No tasks assigned" · body "Tasks assigned to this agent will appear here." | Tab shows count "Tasks 3" (count hidden when 0) |
| **Logs** (derived from real events) | same events as Activity, rendered as log lines | mono 12/18: `22:41:07.123  INFO   agent.activity  run_command  "Running backend tests"  [simulator]`; level color: INFO muted, WARN waiting, ERROR failed; long lines wrap | "No log lines yet" · "Log lines are derived from this agent's events." | Notice: "Derived from stored events — live log streaming arrives in Phase 2" |
| **Files** (sample) | deterministic sample per agent id (seeded generator, stable across renders) | change badge `M`/`A`/`D` (mono, muted box) · path (mono) · relative time; 5–6 rows; non-interactive | n/a | Notice: "Sample data — not connected (Phase 1)" |
| **Git** (sample) | deterministic sample per agent id | "Branch" `feature/sw-123-lost-goods-api`; "Working tree" "2 modified, 1 added"; "Recent commits": short hash (mono) · message · relative time (3–5 rows); non-interactive | n/a | Notice: "Sample data — not connected (Phase 1)" |

- Tasks tab sort order: active (by priority critical→low), then todo, then completed / failed /
  cancelled (newest first). Tasks rows are not clickable (no task view in Phase 1).
- Activity bottom: secondary button "Load older" (`before` cursor, 50 per page) → while pending
  "Loading…" + disabled; when a page returns < 50: replaced by "Beginning of activity" (`text-xs` muted).
- **Notice** component (top of Logs/Files/Git panels, always visible, not dismissible): `--raised`
  bg, 1 px dashed `--border-strong`, r-md, `Info` (Logs) / `FlaskConical` (Files, Git) icon 14,
  `text-xs` secondary. Sample tabs have **no** buttons or links that imply real operations.
- Loading per tab: 5 skeleton rows. Error per tab: §11.4 inline error ("Couldn't load activity." /
  "Couldn't load tasks.") with "Retry".

### 7.4 Panel states

| State | Display |
|---|---|
| Opening (agent in store) | Render store data immediately; refresh with `GET /api/agents/:id` silently |
| Opening (not in store yet) | Header + fields skeletons |
| Agent not found (REQ-083) | `UserX` icon · title "Agent not found" · body "No agent with ID “99-nobody” exists." · primary button "Close" |
| Backend unavailable | Panel content stays, greyed (§11.3); tabs that need fetching show the inline error |

### 7.5 Focus

- Open: remember `document.activeElement`; focus the name heading (`tabindex="-1"`) so screen
  readers announce the agent. Swap (another agent): focus stays where the user clicked; heading text
  updates (announced via `aria-labelledby` change is not reliable → also update a polite live region
  "Showing Frontend Engineer").
- Close: return focus to the remembered element if still in the DOM; otherwise to the agent's roster
  card. Desktop: no focus trap (non-modal); tablet/mobile: focus trapped.

### 7.6 Closing rules

- X button, `Esc` (when focus is inside the panel or on the page body; if focus is inside the
  simulator dock, `Esc` closes the simulator first — the most recently opened layer wins), mobile "Back".
- **Click outside**: a pointerdown on the office empty floor, the page background/gutters or the
  metrics row closes the panel. Pointerdown on an agent target (canvas desk, roster card, feed agent
  button) **swaps** the agent. Pointerdown on any other interactive control (top bar, feed controls,
  simulator dock) does **not** close the panel. Tablet/mobile: scrim click closes.
- Closing clears `?agent=` and the selected highlight in office and roster.

---

## 8. Live activity feed

### 8.1 Column

Header (44): "LIVE ACTIVITY" eyebrow; controls right: toggle chip "Hide demo" (`aria-pressed`,
persisted in `localStorage` `vo.feed.hideDemo`) and severity select (`All events` / `Warnings and
errors` / `Errors only`, default All; client-side). When a project filter is active a sub-header
line (24) shows "Filtered: Sellway" + text button "Show all projects" (sets selector to All Projects).
List: newest first, virtualization not required (cap 200 rows in memory, REQ-091). Day divider rows
("Today", "Yesterday", "Oct 1") sticky at list top, `text-caption` muted.
Footer when the cap is reached: "Showing the latest 200 events. Open an agent for its full history."

### 8.2 Row anatomy (min 56, padding 8×12, divider subtle)

```
│▌ ▲ 22:41:07  (BE) Backend Engineer           [Sellway] [DEMO] │  line 1
│▌           run_command — Running backend tests, pid 4182 …     │  line 2 (2-line clamp)
```
- `▌` left bar 2 px: warning `--st-waiting`, error `--st-failed`, info none.
- Severity icon 14 (warning `TriangleAlert`, error `CircleX`) + visually-hidden "Warning:"/"Error:";
  info: empty 14 px slot (alignment).
- Time: "HH:mm:ss" `text-xs` tabular muted, fixed 56 px; `title` = full local date-time.
- Agent: avatar 18 + name `text-sm` 500 primary as a **button** (opens detail panel, REQ-080).
  System events: `Server` icon in an 18 px neutral circle + "System" (not a button).
- Project tag (neutral: `--raised` bg, 1 px subtle, r-sm, `text-xs` secondary); absent if none.
- DEMO tag when `source = "demo"`: "DEMO" `text-caption` 10 px, `--text-muted`, 1 px dashed
  `--border-strong`, r-sm.
- Line 2: event label (§8.3) in mono 12 `--text-secondary`, then " — " and message `text-sm`
  primary; plain text only (REQ-092); clamp 2 lines, full message in the agent's Activity tab.

### 8.3 Event label mapping

| type | Line-2 label |
|---|---|
| `agent.activity` | the `action` value (e.g. `run_command`) |
| `agent.status.changed` | "Status →" + status chip sm |
| `agent.task.assigned` / `started` / `completed` / `failed` | "Assigned SW-123" / "Started SW-123" / "Completed SW-123" / "Failed SW-123" |
| `agent.task.progress` | "Progress SW-123 · 40%" |
| `agent.message` | "Message" |
| `agent.connected` / `agent.disconnected` | "Connected" / "Disconnected" |
| `system.info` / `system.warning` / `system.error` | "Info" / "Warning" / "Error" |
| task create / update events (name per API_CONTRACTS) | "Task created SW-130" / "Task updated SW-123" |
| unknown future type | the raw `type` string |

### 8.4 Live behavior

- New row: inserted at top; background `--accent-tint` fading to transparent over 1500 ms; enter
  `translateY(-4px)→0` + opacity, 160 ms. Reduced motion: tint for 1500 ms then removed, no motion.
- **At top** (`scrollTop ≤ 24`): rows insert, view stays pinned to newest.
- **Scrolled down** (`scrollTop > 24`): keep the user's reading position (compensate `scrollTop`
  by inserted height); show sticky pill at list top "3 new events" with `ArrowUp` (`--accent-strong`
  bg, white text, pill, `text-xs` 600). Click → smooth scroll to top (instant under reduced
  motion) and reset count; count also resets when the user reaches the top. Pill is a button;
  count updates are not live-announced.
- Filter change: clear list, show 6 skeleton rows, refetch `GET /api/events?project=…&limit=50`.
- Dedup by event `id`; on socket (re)connect the list is merged with a refetch (REQ-052).

### 8.5 Feed states (copy)

| State | Copy |
|---|---|
| Loading | 6 skeleton rows |
| Empty (All Projects) | Title "No activity yet" · body "Events appear here in real time. Use the Developer Simulator or turn on Demo mode to generate some." |
| Empty (filtered) | Title "No activity for Sellway yet" · body "Events for this project will appear here in real time." |
| Empty after client filters | Title "No matching events" · body "Adjust “Hide demo” or the severity filter." + text button "Reset filters" |
| Error | §11.4 inline error: "Couldn't load activity." + server/network message + "Retry" |

---

## 9. Developer Simulator

### 9.1 Placement and container

- Desktop: **dock** inside the main column, `position: sticky; bottom: 0`, height 200, full main
  width, `--panel`, 1 px subtle border, r-lg top corners, shadow overlay. Opening shrinks the office
  (formula §2.2) — the office is never covered at scroll 0; the roster scrolls between office and
  dock. Tablet: bottom sheet; mobile: full-screen sheet (§2.6/2.7).
- Open/close: top bar "Simulator" button, dock X (`aria-label="Close Developer Simulator"`), `Esc`
  inside the dock. Open state persisted in `localStorage` `vo.simulator.open`. On open, focus →
  Agent select; on close, focus → top bar button.
- Region: `<section role="region" aria-label="Developer Simulator">`.
- Header (36): title "Developer Simulator" (`text-title-sm`) · hint "Sends real events through the
  backend API" (`text-xs` muted) · X.

### 9.2 Layout (desktop dock, 3 sections; inline labels 64 px wide; controls h 32 / buttons h 28)

```
┌ Developer Simulator   Sends real events through the backend API                                         [X] ┐
│ TARGET                       │ STATUS                                       │ SEND ACTIVITY                    │
│ Agent   [Backend Engineer (Idle) ▾] │ [○ Set Idle ][◌ Start Planning][⌁ Start Work ] │ Action  [run_tests       ][Info ▾] │
│ Project [Sellway             ▾] │ [‖ Set Waiting][⌕ Start Review ][✓ Complete   ] │ Message [Running API tests       ] │
│ Task    [SW-123 · Lost Goods API ▾]│ [▲ Fail     ][⏻ Set Offline ]               │                     [Send Event]   │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ✓ Accepted · Backend Engineer → Working · 22:41:07                       (feedback line, 20 px, role=status) │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
 section widths ≈ 30% / 37% / 33%, gap 16, padding 12
```

### 9.3 Fields

| Field | Control | Options / rules |
|---|---|---|
| Agent (required) | native `<select>` styled (§12) | placeholder option "Select an agent…" (default); 15 options "Backend Engineer (Idle)" — status suffix live. On change: Project := agent.currentProject ?? None; Task := agent.taskId if it belongs to that project, else None. If the simulator opens while the detail panel shows an agent and Agent is empty, preselect that agent. |
| Project | native select | "None" + Sellway, Ishkun24, ERP, Ana Market. Changing it resets Task to None. |
| Task | native select | Disabled with placeholder "Select a project first" when Project = None. Else "None" + tasks of the project from the store: "SW-123 · Lost Goods API (To do)". Project without tasks: "None" + disabled option "No tasks in Sellway". |
| Status actions | 8 buttons (§9.4) | send `agent.status.changed` (`source:"simulator"`) with selected project/task |
| Action (required for Send Event) | `<input list="vo-actions">` + `<datalist>` | suggestions in order: `run_tests`, `read_file`, `write_file`, `edit_file`, `search`, `run_command`, `git_status`, `git_diff`, `git_commit`, `test`, `build`, `browser`, `wait`, `error`; free text allowed; placeholder "e.g. run_tests" |
| Severity | native select, 96 px | "Info" (default), "Warning", "Error" |
| Message (optional) | `<input>` | placeholder "What is the agent doing?"; counter "1,850/2,000" appears at ≥ 1,800 chars |
| Send Event | primary button | submits `agent.activity` with action, message, severity, project, task. Enter in Action or Message submits (form). |

Force checkbox: **not shown in Phase 1** (see §16 issue I-1).

### 9.4 Status buttons

Exact labels and targets (3-column grid, order fixed):

| Button | Icon | Status sent |
|---|---|---|
| "Set Idle" | `Circle` | idle |
| "Start Planning" | `CircleEllipsis` | planning |
| "Start Work" | `Activity` | working |
| "Set Waiting" | `CirclePause` | waiting |
| "Start Review" | `Search` | reviewing |
| "Complete" | `CircleCheck` | completed |
| "Fail" | `TriangleAlert` | failed |
| "Set Offline" | `PowerOff` | offline |

Button = secondary style, h 28, icon 14 in the status color + label `text-sm`. Legality hints use the
shared state machine with the agent's **current live status** (REQ-102):

| Button state | Visual | Behavior |
|---|---|---|
| Legal | secondary | sends |
| Current status | `--raised-hover` bg, 1 px status-color border, `aria-pressed="true"`, suffix sr-only "(current)" | sends; server no-op → feedback "No change · Backend Engineer is already Working" |
| Illegal from current | 1 px **dashed** `--border-strong`, label `--text-muted`, icon at 50%; `title` + `aria-describedby`: "Not allowed from Idle — the server will reject this" | still clickable (not `disabled`); shows the server's 409 message |
| No agent selected | `disabled` (opacity .45) | hint under section: "Select an agent to enable actions." |
| Pending (any request in flight) | **all** 8 buttons + Send Event disabled; clicked button shows 14 px spinner in place of icon, `aria-busy="true"` | no double submit (REQ-104) |
| Backend unavailable | all disabled | feedback line: "Simulator is unavailable while the backend is offline." |

### 9.5 Validation and feedback (feedback line `role="status"`; errors `role="alert"`)

| Case | Inline result |
|---|---|
| Send Event with empty Action | Action border `--st-failed`, message under field "Action is required." — no request |
| Action > 100 chars | "Action must be 100 characters or fewer." |
| Message > 2000 chars | "Message must be 2,000 characters or fewer." |
| (Rules come from the shared Zod schema, REQ-023) | first issue shown per field |
| Status accepted | `CircleCheck` (completed color) "Accepted · Backend Engineer → Working · 22:41:07" |
| Activity accepted | "Event sent · run_tests · 22:41:07" |
| Same status | `Info` "No change · Backend Engineer is already Working" |
| 409 ILLEGAL_TRANSITION | `CircleX` (failed) + server `error.message` verbatim, e.g. "Illegal transition: idle → completed"; second part muted: "Allowed from Idle: Start Planning, Start Work, Set Offline" |
| 400 / 422 / 413 | server `error.message` verbatim; if `details[0]` exists append " (path: message)" |
| Network failure / timeout (10 s) | "Can't reach the server. Check that the backend is running." |
| Socket not connected but HTTP ok | buttons stay enabled; persistent muted note "Live updates are paused — results will appear after reconnecting." |

Success feedback clears after 4 s; errors persist until the next action or a field change. The UI
never changes agent state from the simulator directly — only via the API response/broadcast (REQ-104).

---

## 10. Demo mode

- Control: top bar switch "Demo mode" (off by default). Tooltip: "Simulates realistic team activity
  through the backend every few seconds. Demo changes are rolled back when you turn it off; your own
  changes are kept."
- Start/stop call the demo API (contract owned by tech-lead, see §16 I-3). Pending: switch disabled,
  label "Starting…" / "Stopping…". The switch reflects **server** demo state (initial fetch +
  broadcast) so every open tab agrees.
- Running indication: DEMO badge in the top bar (§3 #3); demo rows in the feed carry the DEMO tag
  (§8.2); "Hide demo" chip in the feed header.
- Stop result: toast "Demo mode stopped. Demo changes were rolled back." (append counts if the API
  returns them: "· 9 agents and 6 tasks restored").
- Errors: toast (error) "Couldn't start demo mode. <server message>" / "Couldn't stop demo mode.
  <server message>"; switch returns to the server state.
- Backend unavailable: switch disabled, `title` "Unavailable while the backend is offline".

---

## 11. System states (exact copy)

### 11.1 System status pill (top bar)

| Condition | Pill |
|---|---|
| Before first health result | "Checking…" (idle gray) |
| Health OK and socket connected | "Operational" (working green) |
| Health OK and socket reconnecting/disconnected | "Degraded" (waiting amber) |
| Health failing (network error, timeout 5 s, 503) | "Backend unavailable" (failed red) |

Health is polled every 15 s while OK and every 5 s while failing. Tooltip: "Operational: API and live
updates are healthy." / "Degraded: the API responds but live updates are interrupted." / "Backend
unavailable: the API at /api is not responding."

### 11.2 Connection pill + banners

| Socket state | Pill (icon + text) | Banner under top bar (full width, 40 px) |
|---|---|---|
| Initial connect | `RefreshCw` "Connecting…" (amber) | none |
| Connected | `Wifi` "Connected" (green) | none; after a recovery: success banner "Reconnected — data refreshed." auto-hides after 3 s |
| Reconnecting (first 30 s of a drop) | `RefreshCw` (rotating 1 s linear; static under reduced motion) "Reconnecting" (amber) | warning: "Live updates paused — reconnecting to the server…" |
| Disconnected (> 30 s, browser offline, or server-closed) — retries continue with backoff (max 10 s) | `WifiOff` "Disconnected" (red) | error: "Disconnected from live updates. The data on screen may be out of date." + secondary button "Reconnect" (forces an immediate attempt; pending → "Reconnecting…") |

The pill container is `role="status" aria-live="polite"`, announcing "Live updates: Reconnecting" etc.
Only one banner is shown at a time; priority: Backend unavailable > Disconnected > Reconnecting.

### 11.3 Backend unavailable

- **With cached data** (lost after a successful load): error banner "Backend unavailable — showing
  last known data from 22:41:07. Actions are paused." + button "Retry" (pending "Retrying…") +
  muted text "Retrying automatically every 5 s". Metrics, office card, roster, feed and panel are
  greyed: `opacity: .6; filter: grayscale(.6)`, `aria-disabled` on interactive cards is **not** set
  (they still open the panel from cache); simulator and demo disabled (§9.4, §10).
- **No data yet** (fails at start): content area shows a centered state card (max-width 480):
  `ServerOff` icon 32 · title "Can't reach the AI Virtual Office server" · body "The backend isn't
  responding. Make sure it is running (npm run dev), then try again." · primary "Retry" · muted
  "Retrying automatically in 5 s" (countdown). Top bar stays live (clock, pills).
- Recovery (health OK): banner removed, data refetched, greying removed, toast none.

### 11.4 Inline section error and loading

- Inline error (any section/tab fetch): `CircleX` 16 failed · title (per section, e.g. "Couldn't load
  activity.") · `text-xs` secondary detail = `error.message` or "Network error" · secondary button
  "Retry". `role="alert"` on first appearance.
- Loading: skeleton blocks (`--raised`, r-sm) with a 1.2 s shimmer (`--raised`→`--raised-hover`),
  static under reduced motion. Office loading: the card shows the static floor plan placeholder
  (8 room outlines in `--border-subtle`) + centered `text-sm` muted "Loading office…".
- Timeout: any initial load still pending after 10 s switches to its error state (REQ-140).

### 11.5 Toasts

Bottom-right (above the simulator dock when open), max 3 stacked, width 320, `--raised`, shadow
overlay. Info/success auto-dismiss 4 s; errors 8 s with X (`aria-label="Dismiss"`). Container
`aria-live="polite"`. Used only for demo results; everything else is inline.

---

## 12. Shared components (variants and states)

| Component | Variants | States |
|---|---|---|
| Button | primary (`--accent-strong`, white, hover `--accent-strong-hover`), secondary (`--raised`, 1 px `--border-strong`, primary text, hover `--raised-hover`), ghost (transparent, secondary text, hover `--raised`), icon (32×32 ghost) · sizes sm 28 / md 32 · r-md | default, hover, focus-visible ring, active (bg 1 step darker), disabled (opacity .45, `cursor:not-allowed`), pending (14 px spinner replaces icon, label kept, `aria-busy`) |
| Input / native select | h 32, `--bg-sunken`, 1 px `--border-strong`, r-md, `text-sm`, placeholder `--text-muted`; select uses `ChevronDown` background icon and `color-scheme: dark` | hover border `#4A515D`, focus border `--accent` + ring, error border `--st-failed` + message `text-xs` failed with `TriangleAlert` 12, disabled opacity .5 |
| Switch | 32×18 track, off `--border-strong`, on `--accent-strong`, thumb 14 `--text-primary`; `role="switch"` | hover, focus ring, pending (spinner in thumb), disabled |
| Toggle chip | h 24, pill, `text-xs`, off `--raised`/secondary, on `--accent-tint` + accent border + `--accent-text` | `aria-pressed` |
| StatusChip | sm (h 20, icon 12, `text-xs` 600), md (h 24, icon 14, `text-sm` 600); fill chip tint, border status @ 40%, text status color | static |
| TaskStatusChip / PriorityLabel | per §1.3 | static |
| Avatar | 18 / 28 / 40, circle, dept bg + 1 px dept ring, initials = agent `code` (≤ 3 chars) `text-xs`/`text-sm` 600 primary | offline: grayscale(1), opacity .7 |
| ProgressBar | h 3 / 6, track `--border-subtle`, fill status color, r-sm; `role="progressbar" aria-valuemin=0 aria-valuemax=100 aria-valuenow` | 0 → empty track |
| ProjectTag / DemoTag | §8.2 | static |
| Banner | warning / error / success; 40 px, full width, tinted bg (§1.2), left icon, text `text-sm` primary, optional action button right | — |
| EmptyState | icon 24 muted, title `text-title-sm`, body `text-sm` secondary, optional action; centered, padding 32 | — |
| Skeleton | §11.4 | — |
| Tooltip | `--raised-hover`, r-md, `text-xs`, 250 ms delay, shown on hover **and** focus | — |

Icons: lucide-react, stroke 1.75, sizes 12/14/16/20; always `aria-hidden` with visible text nearby.

---

## 13. User flows

| ID | Flow (happy path → alternatives) | REQ |
|---|---|---|
| F-1 | Open app → top bar renders instantly (clock, "Checking…", "Connecting…") → skeletons → data loads → "Operational / Connected". Alt: load fails → §11.3 no-data state; > 10 s → section errors. | 052, 060, 140, 142 |
| F-2 | Select "Sellway" in project selector → URL `?project=sellway` → metrics recount, feed refetches (skeleton), office/roster dim non-Sellway agents, "Filtered: Sellway" line. Clear X / "Show all projects" → All. Reload keeps the filter; invalid `?project=` → All Projects silently. | 061, 062 |
| F-3 | Click Backend Engineer desk (or roster card / feed name) → panel opens, desk + card selected, `?agent=`. Click Frontend desk → swap. Esc / X / empty floor → close, focus returns. Stale `?agent=` → "Agent not found". | 073, 080–083 |
| F-4 | Simulator → Agent "Backend Engineer (Idle)" → Project prefilled Sellway (or choose) → Task "SW-123 · Lost Goods API" → "Start Work" → buttons pending → "Accepted · Backend Engineer → Working" → metrics Working +1, desk working visual, panel fields + duration ticking, feed row at top (all from broadcast). | 102, 104, 191 |
| F-5 | Illegal: agent Idle → "Complete" (dashed) → request → 409 → "Illegal transition: idle → completed · Allowed from Idle: Start Planning, Start Work, Set Offline"; nothing else changes. | 011, 102 |
| F-6 | Send Activity: Action `run_tests`, Message "Running API tests" → Send Event → "Event sent · run_tests" → feed row + panel current action/last message update. Empty Action → "Action is required.", no request. | 103 |
| F-7 | Demo mode on → "Starting…" → DEMO badge, demo-tagged rows every ~3 s → off → "Stopping…" → toast "Demo mode stopped. Demo changes were rolled back." → office returns to pre-demo state except user-changed agents. | 110–112 |
| F-8 | Server stops → "Reconnecting" + warning banner → after 30 s "Disconnected" + "Reconnect" → health fails → "Backend unavailable" banner, UI greyed, simulator/demo disabled → server back → "Reconnected — data refreshed.", greying removed, feed merged without duplicates. | 052, 053, 142, 143 |

---

## 14. Accessibility (WCAG 2.2 AA)

- **Landmarks**: `header` (top bar), `main` (metrics + office + roster), `aside aria-label="Live
  activity"`, detail `dialog`, simulator `region`. First focusable: "Skip to agents list".
- **Tab order**: skip link → project selector (→ clear X) → Demo switch → Simulator button → (banner
  action if any) → skip link "Skip to agents list" before office → roster cards (15 buttons) → feed
  controls → feed agent buttons / "N new events" → simulator dock (when open) → detail panel (when
  open, DOM-placed after main so Tab reaches it; focus moved into it on open). Metrics and canvas are
  not in the tab order.
- **Canvas**: `role="img"` host with a live-updated summary `aria-label` (§5.1); the **roster is
  the accessible equivalent** (all fields, opens the panel). Canvas-only info (animations) is
  decorative; status text exists in roster/panel/tooltip.
- **Not color only**: every status = icon + text (chips, roster, metrics labels, legend, feed);
  severity = icon + hidden text prefix; illegal simulator buttons = dashed border + description text.
- **Contrast**: all text tokens ≥ 4.5:1 on their surfaces (§1); focus ring `--accent` ≥ 5.6:1 vs
  `--bg`/`--panel` (≥ 3:1 non-text). Disabled controls are exempt but keep ≥ 3:1 for their label.
- **Live regions**: connection pill (polite); simulator feedback (`status`) / errors (`alert`);
  panel swap announcement (polite); toasts (polite). The feed list and clock are **not** live regions.
- **Keyboard**: everything operable; `Esc` closes the topmost layer; tabs use arrow keys; selects
  are native; switch toggles with Space; roster cards Enter/Space. Targets ≥ 24×24 CSS px (2.5.8).
- **Reduced motion**: §1.6 (CSS) and §5.4 (Phaser) — evaluated via `matchMedia` and re-applied on
  change without reload.
- **Text safety**: all producer text is rendered as plain text in React and Phaser (REQ-092/163).
- **Zoom**: layout works at 200% browser zoom (falls into the laptop/tablet mode naturally).

---

## 15. Formats

| Item | Format | Example |
|---|---|---|
| Clock | `HH:mm:ss` 24 h local | 22:41:07 |
| Feed / list time | `HH:mm:ss`; day dividers for other days | 22:41:07 |
| Absolute time (panel) | today `HH:mm:ss`; else `MMM D, HH:mm` | Oct 2, 14:05 |
| Relative time | < 10 s "just now"; < 60 s "12s ago"; < 60 m "3m ago"; < 24 h "2h ago"; else absolute | 12s ago |
| Duration | `HH:MM:SS`; ≥ 24 h `Dd HH:MM:SS` | 00:03:12 |
| Progress | integer + `%` | 40% |
| Counts | `12/15 online` | — |
| Numbers > 999 | thousands separator | 1,850/2,000 |

Use `Intl.DateTimeFormat` with `hourCycle: 'h23'`, locale `en-GB` for times (24 h) and `en-US`
month names (`MMM D`). All strings live in one copy module (`apps/web/src/copy.ts` or similar) so
localization is possible later (Q-1).

---

## 16. Requirement issues found and classified ideas

### 16.1 Issues (for PM routing)

| ID | Issue | UX decision taken | Needs |
|---|---|---|---|
| I-1 | The PM's brief mentions an optional **Force** checkbox in the simulator, but REQUIREMENTS has no force mechanism (REQ-011 strict rejection, Q-2), and the envelope is strict (unknown fields → 400). A client-side "force" would either be a dead control or bypass the state machine. | Not shown in Phase 1. If wanted, the backend must define it (e.g. simulator-only `metadata.force`, logged) — then add a checkbox "Force (bypass state rules)" under Status with a warning tint. | PM/analyst decision → backlog (OPTIONAL) |
| I-2 | REQ-082 says Logs/Files/Git each show "Sample data — not connected (Phase 1)", while also recommending Logs derived from real events. Labelling real derived data as "sample" would be misleading (CLAUDE.md §16). | Logs derived from real events with notice "Derived from stored events — live log streaming arrives in Phase 2"; Files/Git keep the sample label. | product-analyst: align REQ-082 wording |
| I-3 | Demo Mode needs start/stop/status endpoints and a broadcast of demo state (so the switch and DEMO badge agree across tabs); §13/REQUIREMENTS list none. | UI spec assumes `GET` status + start/stop actions + a socket event for state changes; optional restore counts in the stop response. | tech-lead: API_CONTRACTS (REQUIRED) |
| I-4 | REQ-052 lists Connected/Reconnecting/Disconnected but not the initial state, nor when "Reconnecting" becomes "Disconnected" with infinite auto-reconnect. | Added transient "Connecting…"; Reconnecting = first 30 s; Disconnected after 30 s / browser offline / server close (retries continue). | analyst: note in REQ-052 (minor) |
| I-5 | REQ-060 defines Degraded only as "reconnecting"; socket disconnected + health OK is undefined. | Degraded = health OK and socket not connected (either state). | analyst (minor) |
| I-6 | 409 copy: REQ-102 shows "Illegal transition: idle → completed" as the server message. The UI shows `error.message` verbatim, so the server must produce human-readable messages in that exact form. | UI adds the computed "Allowed from …" hint itself. | tech-lead/backend: message format in API_CONTRACTS (REQUIRED) |
| I-7 | At < 1760 px the detail panel covers the feed (overlay on the right column). REQ-100's "do not hide feed" constraint is about the simulator, which it satisfies; but the REQ-191 check (d) at 1440 needs the panel closed or the panel's Activity tab. | Accepted; at ≥ 1760 everything is visible at once (docked panel). | QA: run REQ-191 at 1920×1080 |
| I-8 | REQ-083 mentions a "stale URL" for the panel but no URL scheme is defined. | `?agent=<id>` alongside `?project=`. | architect/frontend (RECOMMENDED, included) |
| I-9 | §15 "select … Status" is realized by the 8 status buttons (each button = choose status + send), not by a separate Status select. | As specified in §9. | auditor note |
| I-10 | Office desk coordinates and `deskId`s are defined here (§5.2); seed/shared constants must match. | Table §5.2 is canonical. | architect/database: use these ids |

### 16.2 Classified ideas

| Class | Idea | Status in this spec |
|---|---|---|
| REQUIRED | Demo API + demo-state broadcast (I-3) | needs contract |
| REQUIRED | Human-readable server error messages for 409/422/400 (I-6) | needs contract |
| RECOMMENDED | `?agent=` URL param (I-8) | included |
| RECOMMENDED | HTML tooltip over canvas (REQ-073) | included |
| RECOMMENDED | Severity select in Send Activity (lets QA test warning/error rows) | included |
| RECOMMENDED | Logs derived from real events (I-2) | included |
| RECOMMENDED | "Load older" in the Activity tab (uses REQ-024 `before`) | included |
| RECOMMENDED | Room header "N active" counts | included |
| RECOMMENDED | Restore counts in demo-stop toast | included if API returns them |
| OPTIONAL | Force checkbox (I-1) | backlog |
| OPTIONAL | Metric cards clickable to filter the roster by status | backlog (cards are non-interactive now) |
| OPTIONAL | Demo interval control in the UI (server config for now) | backlog |
| OPTIONAL | Arrow-key navigation inside the canvas / roving tabindex in roster | backlog |
| OPTIONAL | Mobile "Office" tab with a scaled read-only canvas | backlog |
| OPTIONAL | Per-project color dots on project tags | rejected for Phase 1 (color overload) |
