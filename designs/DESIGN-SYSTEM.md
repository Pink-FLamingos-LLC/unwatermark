# Tabletop Companion — Design System

## Project Overview

| Field        | Value                                                |
| ------------ | ---------------------------------------------------- |
| **Name**     | Tabletop Companion                                   |
| **Platform** | Mobile-first dark-mode web app                       |
| **Purpose**  | Launchpad/dashboard for tabletop board game sessions |
| **Origin**   | Stitch project `15157858376069357466`                |
| **Theme**    | Tactile, Professional, Functional — "Modern Tactile" |

---

## Color Palette

### Surface Scale

| Token                       | Hex       | Role                          |
| --------------------------- | --------- | ----------------------------- |
| `surface-ebony`             | `#0A0B14` | Deepest background (Level 0)  |
| `surface-charcoal`          | `#141625` | Cards, containers (Level 1-2) |
| `surface-container-low`     | `#1a1b24` | Subtle elevation              |
| `surface-container`         | `#1e1f29` | Elevated surfaces             |
| `surface-container-high`    | `#282933` | High elevation                |
| `surface-container-highest` | `#33343e` | Maximum elevation             |
| `surface-dim`               | `#12131c` | Dimmed surface                |
| `surface-bright`            | `#383843` | Bright surface                |
| `surface-variant`           | `#33343e` | Variant surface               |

### Text Colors

| Token                | Hex       | Role                     |
| -------------------- | --------- | ------------------------ |
| `on-surface`         | `#e3e1ef` | Primary text             |
| `on-surface-variant` | `#becab9` | Secondary/muted text     |
| `on-background`      | `#e3e1ef` | Background text          |
| `inverse-surface`    | `#e3e1ef` | Inverted surface text    |
| `inverse-on-surface` | `#2f303a` | Text on inverted surface |

### Meeple Accents (Functional)

| Token           | Hex       | Role                                                 |
| --------------- | --------- | ---------------------------------------------------- |
| `primary`       | `#78dc77` | Success, active players, primary actions             |
| `secondary`     | `#9ecaff` | Info, links, secondary navigation                    |
| `meeple-red`    | `#F44336` | Critical errors, health tracking, negative modifiers |
| `meeple-yellow` | `#FFEB3B` | Warnings, victory points, active highlights          |
| `tertiary`      | `#e7bdb1` | Structural accents                                   |

### Semantic Colors

| Token                | Hex       | Role                    |
| -------------------- | --------- | ----------------------- |
| `error`              | `#ffb4ab` | Error state             |
| `on-error`           | `#690005` | Text on error           |
| `error-container`    | `#93000a` | Error container         |
| `on-error-container` | `#ffdad6` | Text on error container |

### Structural Accents

| Token                | Hex       | Role                           |
| -------------------- | --------- | ------------------------------ |
| `wood-dark`          | `#3E2723` | "Game table" texture, nav bars |
| `tertiary-container` | `#b89388` | Tertiary container             |

### Container/On-Container Pairs

| Container                       | On Container                       |
| ------------------------------- | ---------------------------------- |
| `primary-container` (#4caf50)   | `on-primary-container` (#003c0b)   |
| `secondary-container` (#1e95f2) | `on-secondary-container` (#002b4d) |
| `tertiary-container` (#b89388)  | `on-tertiary-container` (#472c24)  |

---

## Typography

**Font Family:** Inter (400, 500, 600, 700)

| Token                | Size | Weight | Line Height | Letter Spacing | Use                        |
| -------------------- | ---- | ------ | ----------- | -------------- | -------------------------- |
| `display-lg`         | 32px | 700    | 40px        | -0.02em        | Hero numbers, game titles  |
| `headline-lg`        | 24px | 700    | 32px        | —              | Section headers (desktop)  |
| `headline-lg-mobile` | 20px | 700    | 28px        | —              | Section headers (mobile)   |
| `headline-md`        | 20px | 600    | 28px        | —              | Sub-headers                |
| `body-lg`            | 18px | 400    | 28px        | —              | Extended reading           |
| `body-md`            | 16px | 400    | 24px        | —              | Body text (min for mobile) |
| `label-lg`           | 14px | 600    | 20px        | 0.01em         | Button labels, card titles |
| `label-sm`           | 12px | 500    | 16px        | 0.04em         | Captions, metadata         |

**Rules:**

- Body text never drops below 16px for accessibility during active play
- Labels use tighter letter-spacing and heavier weights for scannability
- Headlines designed for quick rule-reading at a glance

---

## Spacing & Layout

| Token           | Value | Use                              |
| --------------- | ----- | -------------------------------- |
| `base`          | 8px   | Linear spacing scale             |
| `margin-mobile` | 16px  | Outer margins                    |
| `gutter-mobile` | 12px  | Column gutters                   |
| `tap-target`    | 48px  | Minimum interactive element size |
| `card-padding`  | 16px  | Card internal padding            |

**Grid:** 4-column mobile → 8-column tablet  
**Ergonomics:** All interactive elements ≥ 48px height for thumb-zone access  
**Safe Areas:** 16px outer margins prevent edge bleed

---

## Shape Language

| Radius    | Value          | Use                             |
| --------- | -------------- | ------------------------------- |
| `sm`      | 4px (0.25rem)  | Tags, badges, small chips       |
| `DEFAULT` | 4px (0.25rem)  | Default elements                |
| `lg`      | 8px (0.5rem)   | Cards, buttons, inputs          |
| `xl`      | 12px (0.75rem) | Major containers, bottom sheets |
| `full`    | 9999px         | Pills, avatars, circular        |

Inspired by die-cut board game tiles — friendly, tactile, physical feel.

---

## Elevation System

| Level | Name   | Implementation                                    |
| ----- | ------ | ------------------------------------------------- |
| 0     | Floor  | `surface-ebony` base background                   |
| 1     | Table  | Wood grain overlay on `surface-charcoal`          |
| 2     | Tiles  | `surface-charcoal` + 1px `#FFFFFF10` border       |
| 3     | Meeple | FABs/modals with 20% opacity primary green shadow |

**Guidelines:** Crisp edges and color-based depth over heavy blurs. Keep interface feeling fast.

---

## Components

### Buttons

- High-contrast solid fills
- Primary: Meeple Green bg + dark text
- Secondary: Outlined with 2px borders
- Touch feedback: `active:scale-95` transform

### Cards (Tiles)

- Core app building block
- Min padding: 16px
- 12px rounded corners
- Background: `surface-charcoal`
- Border: 1px `#FFFFFF10`

### Input Fields

- Min height: 48px
- Active state: Meeple Blue border + subtle glow
- Focus ring: `ring-secondary/50`

### Counters (Stat Trackers)

- Display-LG typography for numbers
- Flanked by large +/- buttons filling card width

### Chips/Badges

- Status indicators (Active Turn, Poisoned)
- Meeple accent colors with high-contrast text

### Lists

- Clean rows with 1px `surface-charcoal` dividers
- Min row height: 56px for touch accuracy

### Modals

- Full-screen or bottom-sheet
- Dark backdrop at 80% opacity
- Focus on game-critical choices

---

## Texture

Wood grain texture applied sparingly on structural elements:

```css
.wood-texture {
  background-color: #3e2723;
  background-image: url("https://www.transparenttextures.com/patterns/wood-pattern.png");
}
```

Evokes sitting at a premium gaming table.
