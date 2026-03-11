export const SKILL_MD = `# Research-First Design

Don't guess — know. Study real products, learn from the best, then design with confidence.

References are just ingredients. Your product needs its own flavor. Use research for a rock-solid foundation (80%), then breathe soul into it (20%).

Mindset: Research isn't copying the average. It's finding what the TOP 10% do that others don't.

> Always ask: "If I showed this to 10 users tomorrow, what would they remember?"

---

## Before You Start: Discovery

Never design blind. Ask these questions first:

1. WHAT are we building? (Screen type, Platform, Scope)
2. WHO is this for? (Audience, Technical level)
3. WHAT should users accomplish? (Primary action, Success metric)
4. WHAT feeling should it evoke? (Tone, Energy)
5. WHAT JOB is the user hiring this page to do?
   - "Help me decide" (pricing, comparison)
   - "Convince me to trust you" (fintech, healthcare, enterprise)
   - "Get me started without friction" (onboarding, signup)
   - "Show me what to do next" (empty state, dashboard)
   - "Make me feel I'm not missing out" (waitlist, upgrade)
6. WHAT objections might they have?
7. WHAT should they remember tomorrow?
8. ANY constraints? (Brand guidelines, Technical requirements)

Output a Design Brief:
"I'm designing a [WHAT] for [WHO] that helps them [GOAL] and should feel [TONE]. The user's job: [JOB]. Main objection: [OBJECTION]. They should remember: [HOOK]."

---

## The Workflow

0. DISCOVER → Design Brief
1. RESEARCH → Experiment with queries: broad → narrow → leader → 50-100 references
2. ANALYZE → Extract patterns, compare approaches, build steal list (minimum 5 items)
3. DESIGN → Apply craft: typography, color, spacing, copy. Define soul.
4. IMPLEMENT → Build, validate against references and quality gates

---

## Phase 1: Research

Search by facts, not feelings:
- YES: "pricing toggle", "testimonial carousel", "Stripe", "dark mode"
- NO: "user-friendly pricing" (subjective, not searchable)

Query types: Broad, Industry, Style, Specific, Leader (company names), Component, Adjacent, Emotion.

Search loop: Start BROAD → go SPECIFIC → search that COMPANY → try different ELEMENT → go CROSS-PLATFORM → repeat until 50-100 results.

Go deep: Skip the usual suspects. Search adjacent industries. The gold is in the long tail (results 50-100).

Three Lenses:
A. Structure — layout, components, information hierarchy
B. Visual Craft — typography, color, spacing, details, icons, overall vibe
C. Conversion & Soul — hook, objections, trust, uniqueness, microcopy personality

Research is done when: 5+ query variations tried, 50+ screens reviewed, 5+ clever tactics found with EXACT details, at least 1 surprise.

---

## Phase 2: Analyze

Research != Copying the Average. Best practices = starting point, not destination.

Pattern Table: Compare 3-5 best references across layout, typography, color, components, copy.

Steal List (REQUIRED, minimum 5 items):
| Source | EXACT What | Why It Works | How I'll Use It |

Be specific: "Linear — 13px/20px body, -0.01em tracking, 48px gaps, #5E6AD2 accent at 8% opacity"
NOT vague: "Linear — clean design"

---

## Phase 3: Design

### Typography
Scale ratio 1.2 or 1.25. Max 6-8 sizes. Max 2 fonts.
LETTER-SPACING: Body 0, Small text 0.01-0.02em (REQUIRED), ALL CAPS 0.06-0.1em (MANDATORY), Large headings -0.01 to -0.02em, Display -0.02 to -0.03em.
Line length: 50-75 characters.

### Color
4 layers: Neutrals (70-90%), Primary accent (5-10%), Semantic, Effects (rare).
NO INDIGO/VIOLET unless brand requires it. Name tokens by purpose, not color.
Dark theme: separate neutrals, not inverted. Background #0f0f0f, text #f0f0f0.

### Spacing
Base unit: 4px or 8px. Proximity = relationship.

### Avoiding AI Slop
NO default indigo. NO blob backgrounds. NO cookie-cutter layouts.
YES: brand-appropriate color, intentional fonts, visual tension, purposeful whitespace.
Don't default to Hero → Features → Pricing → FAQ → CTA.

### Icons
One style per product. Match text weight. currentColor. 44px hit area.

### The Persuasion Layer
Fill before coding: Hook (3 sec), Story arc, Objection killers (3), Trust signals (pick 2+), Urgency/scarcity, The memorable thing.
If you can't fill this table, you're designing decoration, not persuasion.

### The Soul
~80% proven patterns + ~20% unique choices.
Test: "If someone screenshots this, would they know it's from THIS product?"

---

## Phase 4: Implement

Quality Gate:
- Functional: Primary action obvious? Error states? Works on mobile?
- Visual: Squint test? Spacing rhythm? Typography intentional?
- Persuasion: Hook in 3 sec? 2+ trust signals? Objections addressed?
- Polish: No orphaned words? Icons aligned? Buttons consistent? Something memorable?

Side-by-side test against top 3 references. Target: match or exceed in 3/4 criteria (polish, clarity, uniqueness, usability).

---

## Figma-Specific: Auto-Layout Rules

ALWAYS use frames + auto-layout for containers. Use padding/spacing, NOT hardcoded x/y.
layoutSizingHorizontal: FILL for stretching elements. layoutSizingVertical: HUG for wrapping content.
Clear fills on layout-only frames (transparent). Only set fillColor on genuine backgrounds.

Build order: outer frame → section frames → content → fill/hug sizing → clear unnecessary fills.

---

Don't guess. Craft with intention. Infuse it with soul.`;
