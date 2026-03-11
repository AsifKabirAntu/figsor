export const COLOR_MD = `# Color Guide

Color is the emotional backbone of UI. Get it wrong and your product looks either amateur or AI-generated.

## 0. Context First
Product UI: fewer colors, more neutrals, strict semantics. Marketing: more emotion allowed.
Hard rule: When in doubt — fewer colors, more neutrals, stricter purpose. Restraint beats "colorful."

## 1. Color Space
HSL poorly represents perceptual brightness. OKLCH provides perceptually uniform lightness.
For MVP: Use curated palettes (Tailwind, Radix, Open Color).

## 2. Palette Structure (4 Layers)

### 2.1 Neutrals (70-90% of UI)
10-12 steps: 50 (#fafafa near-white), 100-200 (surfaces/cards), 300-400 (borders), 500 (placeholder text), 600-700 (secondary text), 800-900 (primary text), 950 (#0a0a0a near-black).
Never use pure #000 on white. Don't make text gray "for breathing room" — spacing creates breathing room.

### 2.2 Primary Accent
One brand color with full scale (50-950). Use 500-600 default, 600-700 hover, 700-800 active, 50-100 for tinted backgrounds.

### 2.3 Semantic Colors
Success (green), Warning (amber/yellow), Danger (red), Info (blue optional).
Each semantic needs: base color, background tint, border, on-color for text on solid.

### 2.4 Effects (Only If Needed)
Gradients, glows, illustration tints. In product UI, effects should be rare.

## 3. The 60/30/10 Rule
60-80% neutrals | 10-20% text hierarchy | 5-10% accents and semantics
Maximum 2 colors per component. Hover/Active = slightly darker/lighter, not new random colors.

## 4. Contrast
Body text (<=16px): 4.5:1 | Large text (18px+ bold, 24px+ regular): 3:1 | UI components/icons: 3:1
Test secondary text on multiple devices. If you squint and text disappears, it's too light.

## 5. Dark Theme
NOT just inverted. Dark theme gets its own neutral scale.
Background: #0f0f0f (not #000). Text: #f0f0f0 (not #fff). Surface elevated: #242424.
Elevation via slightly lighter backgrounds + subtle borders + very soft or no shadows.

## 6. Token Naming
Name by purpose, not color: --primary (not --blue), --primary-tint (not --light-blue).
Minimum tokens: bg, surface-1, surface-2, text, text-muted, text-subtle, border, border-strong, primary, on-primary, primary-hover, primary-active, primary-tint, success, warning, danger.

## 7. Building a Palette
Step 1: Choose neutral character (warm or cool).
Step 2: Choose one primary that works on white, dark, in buttons/links/badges.
Step 3: Generate scale using OKLCH or curated generators.
Step 4: Add semantics that don't clash with primary.

## 8. Gradients
Allowed when: they support brand, don't break readability, are localized. Subtle > dramatic.

## 9. Anti-Patterns

### #1 AI SLOP INDICATOR: INDIGO/VIOLET
Every LLM defaults to indigo (#6366f1, #8b5cf6). This is the universal fingerprint of AI-generated design.
Before using purple: Does the brand require it? Did research use it? Is there a semantic reason?
If NO to all — change the color.
Safe alternatives: Blue #2563eb, Teal #0d9488, Green #16a34a, Orange #ea580c.
INDIGO IS BANNED unless explicitly justified.

Other red flags: Multiple competing accents, random hex in components, pure black on white, every state is new color, dark theme = inverted.

## Pre-Ship Checklist
- One primary accent, not 3 "hero colors"
- Neutrals are 70-90% of the interface
- Text readable everywhere
- Hover/Active states predictable and calm
- Tokens named by purpose
- Dark theme is separate, not inverted
- Semantics don't clash with primary
- No random hex — all from tokens
- Contrast passes WCAG AA
- Gradients are rare and localized

Color is restraint. Neutrals are 90% of the work. One accent, used purposefully, beats five competing for attention.
`;
