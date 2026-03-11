export const TYPOGRAPHY_MD = `# Typography Guide

Typography is 90% of web design. Get it right and everything else falls into place. Get it wrong and no amount of polish will save you.

---

## 0. Context First

Before choosing fonts, answer these questions:

| Question | Why It Matters |
|----------|----------------|
| **Work tool or marketing?** | Work products need neutrality, not personality |
| **Long reading or scanning?** | Changes line-height and density decisions |
| **B2B, B2C, or Dev tool?** | Affects font character and weight choices |

**Default approach:**

> When in doubt — go denser, simpler, and more neutral. Clarity beats decoration in most product interfaces.

---

## 1. The Safe SaaS Preset

Before customizing anything, this works:

Font: Inter, system-ui, sans-serif
Base: 16px, Line-height: 1.55, Scale: 1.2
Weights: 400 (normal), 500 (medium), 600 (semibold)
Max width: 65ch
Text colors: Primary #111, Secondary rgba(0,0,0,0.7), Tertiary rgba(0,0,0,0.5)

## 2. Type Scale (Minor Third x 16px base)

11px Caption | 13px Small | 16px Body | 19px Large | 23px H4 | 28px H3 | 33px H2 | 40px H1 | 48px Display | 57px Hero

Rule: Maximum 6-8 sizes in production.

## 3. Font Pairing

Most successful SaaS products use one font family. Two fonts adds complexity.
One font + multiple weights = professional. Two fonts = requires justification. Three fonts = almost never.

Safe choices: SaaS/Tech: Inter, SF Pro, Geist | Finance: Inter, IBM Plex Sans | Startup: Inter, DM Sans, Plus Jakarta | Dev tools: Inter + JetBrains Mono

## 4. Text Color System

Primary: #0B0B0B (100%) | Secondary: rgba(0,0,0,0.65) | Tertiary: rgba(0,0,0,0.45) | Disabled: rgba(0,0,0,0.3)
Never pure black. Body text minimum 60% opacity. 3-4 text colors max.
Dark mode: Primary #F5F5F5, Secondary rgba(255,255,255,0.7), Tertiary rgba(255,255,255,0.5)

## 5. Font Weight

300 Light (large display only) | 400 Regular (body) | 500 Medium (labels) | 600 Semibold (subheadings, buttons) | 700 Bold (headlines)
Larger size = lighter weight OK. Smaller size = heavier weight needed.
Anti-pattern: Using bold (700) for everything flattens hierarchy.

## 6. Line Height

Body: 1.5-1.7 | Short paragraphs: 1.4-1.5 | Headlines: 1.0-1.2 | Large display: 0.9-1.1 | UI text: 1.2-1.4 | Buttons: 1
Longer lines need more leading. Sans-serif needs +0.1 vs serif.

## 7. Vertical Rhythm

Line-height x 0.5 = minimum vertical spacing step.
Spacing matters more than font size. Fix spacing before tweaking fonts.

## 8. Letter Spacing (CRITICAL)

| Text Type | Size | Value | Priority |
|-----------|------|-------|----------|
| Body text | 14-18px | 0 | Default OK |
| Small text | 11-13px | 0.01-0.02em | REQUIRED |
| UI labels/buttons | any | 0.01-0.03em | REQUIRED |
| ALL CAPS | any | 0.06-0.10em | MANDATORY |
| Large headings | 32px+ | 0 to -0.02em | Recommended |
| Display text | 48px+ | -0.02 to -0.03em | Recommended |

Always use em, never px. ALL CAPS without tracking looks cramped and cheap.

## 9. Line Length

Optimal: 50-75 characters (500-700px at 16px). Use max-width: 65ch.
Anti-pattern: Full-width paragraphs on desktop.

## 10. Text Polish

Use proper ellipsis character, curly quotes, non-breaking spaces between number and unit.
Use tabular-nums for prices/tables/stats. Use text-wrap: balance for headings.

## 11. Responsive Typography

Use clamp() for fluid type. Headlines scale more than body text.
Mobile H1: 32-36px, Desktop H1: 48-64px. Base font stays 16-18px.

## 12. Performance

Max 2 font families, max 3 weights per family. Variable fonts preferred. font-display: swap always.

## 13. AI-Slop Anti-Patterns

Red flags: 10+ text sizes, gray text on gray background, bold everywhere, centered paragraphs, ALL CAPS without letter-spacing, inconsistent spacing, too many font weights.

## 14. Hierarchy Checklist

Visual weight stack: 1. Size 2. Weight 3. Color 4. Case 5. Spacing 6. Style
Tests: Squint test (3 clear levels?), 5-second test (what first?), Scan test (skim headings?)

## Pre-Ship Checklist

- Max 6-8 font sizes, max 2 families, 3-4 weights
- Body 16px+, line-height 1.5+, max-width 65ch
- 3-4 text color levels
- ALL CAPS has letter-spacing 0.06em+
- Small text 11px minimum with positive tracking
- Contrast passes WCAG AA (4.5:1 body, 3:1 large)
- Consistent vertical rhythm
- Tested at 320px, 768px, 1440px

Typography is the voice of your interface. Simple, consistent, intentional.
`;
