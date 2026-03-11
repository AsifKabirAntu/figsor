export const ICONS_MD = `# Icons & Glyphs Guide

In product UI, treat icons as typography — functional, not decorative.

## Two Contexts
Product UI: clean outline or solid, one consistent set, predictable and scalable.
Marketing: duotone, gradients, illustrative allowed — never leaks into product.

## Sizing
Small (16px): inline with body text, table cells, dense UI
Medium (20-24px): buttons, nav items, form inputs
Large (28-32px): feature cards, empty states, marketing

## Optical Corrections
Geometric center != visual center. Play triangles shift right 0.5-1px. Chevrons/arrows shift toward point.
Circles appear lighter than squares. Diagonals appear thinner than horizontals. Aim for equal visual mass.

## Style Consistency
One style per product. No exceptions.
Outline: dense UIs, data-heavy products
Solid: consumer apps, clear actions
DON'T mix outline in nav + solid in buttons + duotone in cards. DON'T mix libraries (Lucide + Heroicons = collage).

## Icon + Text Pairing
14-16px text: 16px icon | 16-18px text: 18-20px icon | Headings: 20-24px icon
Match weight to surrounding text. Semibold text + thin icon = "from different systems."

## Color
Default: currentColor (inherits text color). Semantic colors only for status.
Contrast: meaningful icons need 3:1 ratio (WCAG non-text).

## Accessibility
Action icons: aria-label on button. Decorative: aria-hidden="true".
Hit area: 44x44px on touch, 32x32px on desktop (visual can be smaller).

## Libraries
Lucide: SaaS default, outline, 24x24/2px stroke
Heroicons: Tailwind projects, outline + solid
Phosphor: 6 weights, weight flexibility
Material Symbols: variable weight sync with text
SF Symbols: Apple native apps

Icons are typography. Consistent, optical, accessible.`;
