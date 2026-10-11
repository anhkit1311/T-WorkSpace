# Design System Master File — nexo Editorial Glass

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** nexo — Realtime Collaborative Workspace
**Revised:** 2026-10 — rewritten to match the shipped Editorial Glass interface
**Design Dials:** Variance 5/10 (Balanced) | Motion 6/10 (Calm; 60 fps target, not a measured guarantee) | Density 7/10 (Workspace)

**Source of truth in code**

| Concern                          | File                                               |
| -------------------------------- | -------------------------------------------------- |
| Shell tokens, topbar, dock       | `apps/web/src/app/styles/editorial-workspace.css`  |
| Page heroes, states, modals      | `apps/web/src/app/styles/unified-surfaces.css`     |
| Backdrop (video + three.js veil) | `apps/web/src/app/styles/screen-motion.css`        |
| Primitives (Button, Modal, …)    | `apps/web/src/shared/ui/Primitives.tsx`            |
| Motion timing (Motion + GSAP)    | `apps/web/src/shared/motion/tokens.ts`             |

---

## Global Rules

The interface is **light-only**. `AppContext` sets `data-theme="light"`, `color-scheme: light`
and `theme-color #e8eef6` so native controls (`<select>`, `datetime-local`, scrollbars) stay light.
Do not add OS theme detection or a theme toggle unless the product direction changes.

### Color Palette (authenticated workspace, `.app-shell`)

| Role                     | Value                        | CSS Variable                     |
| ------------------------ | ---------------------------- | -------------------------------- |
| Primary (navy)           | `#263450`                    | `--primary`                      |
| Primary strong / hover   | `#1B263B`                    | `--primary-strong`               |
| Primary soft             | `rgba(38, 52, 80, 0.10)`     | `--primary-soft`                 |
| Ink                      | `#17233E`                    | `--editorial-text` / `--text`    |
| Ink secondary            | `#31415B`                    | `--editorial-text-secondary`     |
| Ink muted                | `#3E4E66`                    | `--editorial-text-muted`         |
| Glass card               | `rgba(246, 248, 252, 0.64)`  | `--editorial-surface-card`       |
| Glass popup              | `rgba(243, 246, 252, 0.92)`  | `--editorial-surface-popup`      |
| Glass soft strip         | `rgba(255, 255, 255, 0.24)`  | `--editorial-surface-soft`       |
| Glass edge               | `rgba(255, 255, 255, 0.36)`  | `--editorial-border`             |
| Hairline                 | `rgba(23, 35, 62, 0.10)`     | `--editorial-border-soft`        |
| Opaque panel (dense UI)  | `rgba(255, 255, 255, 0.78)`  | — (meeting controls, QoS card)   |
| Success / online         | `#10B981`                    | —                                |
| Warning / connecting     | `#F59E0B`                    | —                                |
| Offline / hidden         | `#94A3B8`                    | —                                |
| Danger text on tint      | `#B91C1C` on `#FEF2F2`       | `.inline-alert`, alerts          |

**Rules**

- Navy is the only accent. Never use pure black (`#000`) for selected/active states; use `--primary`.
- Pure black is reserved for the in-call control dock (`.meeting-controls-dock`) over video.
- Status colors are semantic only (presence, alerts, badges); never decorative.

### Typography

| Role    | Family             | Token            | Usage                                          |
| ------- | ------------------ | ---------------- | ---------------------------------------------- |
| Display | Playfair Display   | `--font-display` | Page titles, card titles, brand moments        |
| Body    | Inter              | `--font-body`    | All UI text, labels, buttons                   |
| Mono    | JetBrains Mono     | `--font-mono`    | `code`, `kbd`, QoS figures, session IDs        |

- Fonts are loaded once in `apps/web/index.html`.
- Playfair defaults to old-style figures; the shell sets `font-variant-numeric: lining-nums`
  so "0" never reads as "o".
- Page title: `clamp(2.2rem, 3.5vw, 3rem)`, weight 500, letter-spacing `-0.015em`.

### Glassmorphism

| Element            | Background                    | Blur                     | Radius | Shadow                              |
| ------------------ | ----------------------------- | ------------------------ | ------ | ----------------------------------- |
| Page hero / header | `--editorial-surface-card`    | `var(--editorial-blur)`  | 28px   | `0 24px 60px rgba(15,23,42,.10)`    |
| Card / section     | `--editorial-surface-card`    | `var(--editorial-blur)`  | 22px   | `--editorial-shadow`                |
| Filter / head strip| `--editorial-surface-soft`    | `var(--editorial-blur)`  | 22px   | none                                |
| Dense panel        | `rgba(255,255,255,.78)`       | `var(--editorial-blur)`  | 20px   | `0 12px 32px rgba(15,23,42,.06)`    |
| Popover / modal    | `--editorial-surface-popup`   | `var(--editorial-blur)`  | 22–28px| `0 24px 60px rgba(15,23,42,.16)`    |

- `--editorial-blur` is **10px**. Do not stack more than two blurred layers.
- Never paint headings, labels or filters directly onto the landscape backdrop — wrap them in a
  page hero or a soft strip.

### Radius & Spacing

| Token / value                | Usage                          |
| ---------------------------- | ------------------------------ |
| `9999px` (`--editorial-radius-pill`) | Buttons, inputs, chips, call dock |
| `28px`                       | Page heroes, modals            |
| `22px` (`--editorial-radius-card`)   | Cards, sections        |
| `14–20px`                    | Inline alerts, list rows       |
| Page padding                 | `32px clamp(20px, 3vw, 48px) 80px`; mobile `20px 12px 40px` |

---

## Component Specs

Always use the primitives in `Primitives.tsx`; raw `<button>` elements are only acceptable for
bespoke controls with their own class (dock buttons, video tiles, chips).

### Buttons — `<Button variant size icon loading>`

| Variant     | Look                                                | Use                              |
| ----------- | --------------------------------------------------- | -------------------------------- |
| `primary`   | Navy pill, white text                               | One main action per area         |
| `secondary` | Glass pill, hairline border                         | Supporting actions               |
| `ghost`     | Transparent, ink text                               | Tertiary, inline row actions     |
| `danger`    | Red pill                                            | Destructive confirmations only   |

Icon-only actions use `<IconButton icon label>`; the label is required (tooltip + `aria-label`).

### Cards & States

- `.state-card` — centered empty/error state with `.state-card__icon`.
- `.inline-alert` — non-blocking error with optional action.
- `.loading-note` — centered muted status text.

### Inputs

Pill inputs on glass: `border: 1.5px solid rgba(15,23,42,.12)`, background `--editorial-surface-card`,
focus ring `2px solid var(--primary)` offset `3px`.

### Modals — `<Modal title eyebrow footer onClose>`

Use for every confirmation (no `window.confirm`). Footer layout helpers: `.modal-footer-actions`,
`.modal-footer-split`.

---

## Page Pattern

**Pattern Name:** Floating dock + glass stage

- **Desktop:** Topbar (brand · search · notifications · account) → left dock → glass page stage.
- **Mobile (≤768px):** Single-row 56px topbar; dock moves to the bottom; chat channels open as a
  drawer with a scrim (≤680px).
- **Hierarchy:** Page hero (title, one-line purpose, primary actions) → working surfaces.
- **Utilities:** Ctrl/⌘+K search lists every workspace page plus message results.

---

## Motion

Timing lives in `shared/motion/tokens.ts`. Run `npm run motion:css --workspace @doan/web` after changing tokens to regenerate `shared/motion/motion.css`. CSS keyframes live only in `shared/motion/keyframes.css`.

| Layer      | Library    | Behaviour                                                         |
| ---------- | ---------- | ----------------------------------------------------------------- |
| Presence   | Motion     | Views (300ms / 140ms), panels (260ms / 160ms), modals, existing dock pill |
| Reveal     | GSAP       | Stagger of first-level page blocks (550ms, `expo.out`, 50ms each) |
| Atmosphere | three.js   | Motes + valley mist over the video; mood per view, paused in-call |

- Animate only `transform` and `opacity`; clear inline transforms after reveal. Do not use permanent `will-change` or `transition: all`.
- Motion owns controls, presence, panels and view wrappers. GSAP owns first-level reveal children and Three.js uniforms. CSS owns spinner/reveal keyframes and color/border feedback. Never animate the same property on the same element from two owners.
- `useMotionSafe()` supplies complete static presets under `prefers-reduced-motion`: duration 0, opacity 1, no displacement/gesture/stagger. `MotionProvider` synchronizes `html[data-motion]`, CSS and GSAP matchMedia. Video pauses; decorative Three.js renders only its static presentation, with no running scene ticker.
- Workspace tabs replace content immediately, then animate only the new `.ws-body` contents by 6px / 220ms. Cancel superseded animation on rapid navigation; do not keep outgoing tab content behind it.
- Allowed micro patterns: native Button press .97 / hover -1px (snappy), tooltip (400ms pointer, immediate keyboard), existing pressed icon pop, bell notification shake, field error shake ≤4px once, numeric count 600ms, existing reaction picker stagger 20ms, send icon feedback, Toast swipe dismissal. Keep all current labels/icons/static geometry.
- Panels trap focus where modal, release it when exit begins, and make exiting layers inert. Normal-flow chat info closes immediately to avoid reserving an empty column during exit. Preserve current desktop/mobile panel shapes; bottom sheets and new UI blocks require owner approval.
- Full overlays acquire a scene-cover lease. Nested overlays release independently; hidden tabs and meetings pause decorative drawing. Dispose ticker/listeners/observers/geometry/materials/renderer on unmount. Adaptive motes halve once after a continuous 2s below 50Hz; no second scene loop.

| Token | Values |
| --- | --- |
| DURATION (seconds) | micro .12; overlay .22; page .30; story .90; panel .26; panelExit .16; count .60; enter .22; exit .14; reveal .55; stagger .05; scene 1.10 |
| EASE | out [.16,1,.3,1]; inOut [.65,0,.35,1]; emphasized [.2,0,0,1] |
| SPRING (stiffness / damping / mass) | snappy 520 / 38 / .7; gentle 260 / 30 / .9; bouncy 420 / 24 / .7 |

DEV-only `?motion-debug=1` samples rAF callbacks, long tasks, CLS and blurred DOM depth. Its preview buttons test full/reduced presentation without changing the OS preference. rAF Hz is not compositor/GPU FPS; blur DOM depth is not a compositor layer count. This probe is excluded from the production bundle. Evidence and limitations: [motion review](../../docs/ui-review-2026-10-04/motion/README.md).

---

## Anti-Patterns (Do NOT Use)

- ❌ UI that looks interactive but is not wired to real data or actions ("giao diện giả")
- ❌ Hard-coded placeholder content shown as if real (fake pinned messages, fake metrics)
- ❌ `window.confirm` / `window.alert`
- ❌ Dark surfaces inside the light shell (except video stage and call dock)
- ❌ Pure black accents, Notion-blue, teal or plum accents
- ❌ Emojis as icons (emoji are fine as reactions/stickers content)
- ❌ Invisible focus states; layout-shifting hover effects

---

## Pre-Delivery Checklist

- [ ] Every visible control performs a real action or is removed
- [ ] Buttons use `<Button>` / `<IconButton>`
- [ ] Headings and filters sit on glass, not directly on the backdrop
- [ ] Text contrast ≥ 4.5:1 on glass
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px; no horizontal scroll on mobile
- [ ] `npm run typecheck` and `npm run build --workspace @doan/web` pass


## Khóa giao diện — đợt sửa UX 04–05/10/2026

Yêu cầu trực tiếp của chủ dự án ưu tiên hơn các đề xuất tái thiết kế: giữ bố cục, thứ tự, màu navy + glass, Playfair/Inter, bo góc, pill, video + Three.js, topbar + dock và chữ/icon đang hoạt động. Chỉ bổ sung hành vi, trạng thái tương tác, accessibility và reduced motion. Không áp dụng các đề xuất đổi màu/bố cục/cỡ chữ chỉ để khớp luật chung.

- Bảng token trên thuộc scope workspace `.editorial-workspace-shell`: muted `#3e4e66`, surface card `rgba(246,248,252,.64)`. Scope public `:root` vẫn có muted `rgba(15,23,42,.55)`, surface card `rgba(255,255,255,.94)`; đây là hai scope, không thay một giá trị bằng giá trị còn lại.
- Ngoại lệ được giữ theo bản đã chốt: CTA landing đen, Playfair italic; các trạng thái xanh và semantic sẵn có trong workspace, cỡ chữ/bo góc/margin hiện tại. Việc chuẩn hóa lại cần chủ dự án duyệt.
- Font tải tại index.html; Plus Jakarta Sans vẫn còn dùng bởi token legacy `--font-ui`, chưa loại bỏ.
- `shared/ui/interaction.css` chỉ chứa focus/hit target/loading/Toast/reduced motion. Motion sở hữu transform/opacity của modal/toast; CSS chỉ xoay spinner, không điều khiển cùng transform. GSAP/Three.js giữ ownership sẵn có; video và scene dừng khi họp/giảm chuyển động.
- Không thêm thư viện. Ngân sách 60fps là mục tiêu, chưa phải kết quả đo.

Bằng chứng và giới hạn: [ui-review-2026-10-04](../../docs/ui-review-2026-10-04/README.md).
