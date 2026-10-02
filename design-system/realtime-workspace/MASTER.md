# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Realtime Workspace
**Generated:** 2026-09-08 13:08:37
**Category:** Productivity Tool
**Design Dials:** Variance 5/10 (Balanced / Modern) | Motion 4/10 (Standard) | Density 8/10 (Dense / Dashboard)

**Refined:** 2026-09-08 — Swiss/minimal productivity workspace, responsive drawers, functional search, light-only interface

---

## Global Rules

### Color Palette

| Role             | Hex       | CSS Variable                 |
| ---------------- | --------- | ---------------------------- |
| Primary          | `#8F3F76` | `--color-primary`            |
| On Primary       | `#FFFFFF` | `--color-primary-foreground` |
| Secondary        | `#A84C89` | `--color-online`             |
| On Secondary     | `#4A1F3E` | `--plum-900`                 |
| Accent/CTA       | `#D94B18` | `--color-accent`             |
| On Accent/CTA    | `#FFFFFF` | `--color-accent-foreground`  |
| Background       | `#FFF8ED` | `--color-background`         |
| Foreground       | `#2C1D17` | `--color-foreground`         |
| Card             | `#FFFFFF` | `--color-card`               |
| Card Foreground  | `#2C1D17` | `--color-foreground`         |
| Muted            | `#F4ECE4` | `--color-muted`              |
| Muted Foreground | `#6E5547` | `--color-muted-foreground`   |
| Border           | `#E7D8CA` | `--color-border`             |
| Destructive      | `#DC2626` | `--color-destructive`        |
| On Destructive   | `#FFFFFF` | `--color-on-destructive`     |
| Ring             | `#8F3F76` | `--color-ring`               |

**Color Notes:** Warm plum is the product color. Burnt orange is reserved for high-priority actions; cream and brown neutrals reproduce the warmth of the supplied palette reference.

**Left navigation:** use a light plum surface (`#F4E4EF`) with warm-plum selected states (`#8F3F76`) and dark-plum labels (`#73305F`). Do not introduce teal, mint, cyan, or blue accents.

The interface is intentionally light-only. Do not add operating-system theme detection or a theme toggle unless the product direction changes.

### Typography

- **Heading Font:** Plus Jakarta Sans, with Inter/system fallback
- **Body Font:** Inter
- **Mood:** calm, precise, friendly, modern, professional productivity
- **Google Fonts:** [Inter + Inter](https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap)

**CSS Import:**

```css
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap");
```

### Spacing Variables

_Density: 8/10 — Dense / Dashboard_

| Token         | Value              | Usage                     |
| ------------- | ------------------ | ------------------------- |
| `--space-xs`  | `2px` / `0.125rem` | Tight gaps                |
| `--space-sm`  | `4px` / `0.25rem`  | Icon gaps, inline spacing |
| `--space-md`  | `8px` / `0.5rem`   | Standard padding          |
| `--space-lg`  | `12px` / `0.75rem` | Section padding           |
| `--space-xl`  | `16px` / `1rem`    | Large gaps                |
| `--space-2xl` | `24px` / `1.5rem`  | Section margins           |
| `--space-3xl` | `32px` / `2rem`    | Hero padding              |

### Shadow Depths

| Level         | Value                          | Usage                       |
| ------------- | ------------------------------ | --------------------------- |
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)`   | Subtle lift                 |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)`    | Cards, buttons              |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)`  | Modals, dropdowns           |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: #d94b18;
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: #8f3f76;
  border: 2px solid #8f3f76;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: #fff8ed;
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--shadow-md);
  transition: all 200ms ease;
  cursor: pointer;
}

.card:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-2px);
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: #8f3f76;
  outline: none;
  box-shadow: 0 0 0 3px #8f3f7620;
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Flat Design

**Keywords:** 2D, minimalist, bold colors, no shadows, clean lines, simple shapes, typography-focused, modern, icon-heavy

**Best For:** Web apps, mobile apps, cross-platform, startup MVPs, user-friendly, SaaS, dashboards, corporate

**Key Effects:** No gradients/shadows, simple hover (color/opacity shift), fast loading, clean transitions (150-200ms ease), minimal icons

### Page Pattern

**Pattern Name:** Multi-pane Collaboration Workspace

- **Desktop:** Workspace rail > channel navigation > conversation > contextual details.
- **Tablet:** Workspace rail > channel navigation > conversation; details open as a drawer.
- **Mobile:** Conversation first; channels and details open as accessible drawers with a scrim.
- **Hierarchy:** Compact top bar, concise channel context, timeline, messages, persistent composer.
- **Utilities:** Search must return actionable channel/message results; theme control must expose a clear accessible label.

---

## Motion

**Stagger List** (Standard) — Trigger: load or scroll | Duration: 300-450ms | Easing: `back.out(1.4)`

```js
gsap.from(".grid-item", {
  opacity: 0,
  scale: 0.92,
  y: 16,
  duration: 0.4,
  stagger: { each: 0.06, from: "start", grid: "auto" },
  ease: "back.out(1.4)",
});
```

**Framework notes:** grid: 'auto' lets GSAP infer rows/columns from a CSS grid layout for a natural wave stagger; Use matchMedia('(prefers-reduced-motion: reduce)') to skip non-essential motion and render the final state immediately

- ✅ Combine with from: 'center' for a bento-grid layout to draw the eye inward first
- ❌ Don't use back.out on dense data tables; the overshoot reads as sloppy on informational UI
- ⚡ Group DOM writes; avoid interleaving layout reads (getBoundingClientRect) between staggered tweens

---

## Anti-Patterns (Do NOT Use)

- ❌ Complex onboarding
- ❌ Slow performance

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
