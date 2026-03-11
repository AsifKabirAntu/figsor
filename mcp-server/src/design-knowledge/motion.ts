export const MOTION_MD = `# Motion & Micro-interactions Guide

Motion serves three purposes: Feedback ("it worked"), Continuity ("where it went"), Hierarchy ("look here"). If animation doesn't do one — remove it.

## Timing
Instant (90-150ms): hover, press, toggle, focus
State change (160-240ms): accordion, tabs, small panels
Page/large (240-360ms): modal, drawer, route transition
Complex (360-500ms): large layout reflow (rare)
500ms+ in product UI almost always feels slow.

## Easing
Enter (appear): ease-out (fast start, soft landing)
Exit (disappear): ease-in (soft start, fast exit)
State change: ease-in-out (smooth both ways)
NEVER use linear easing — robotic, unnatural.

## Micro-interactions
Button hover: background color shift 120ms
Button press: scale(0.98) 90-120ms
Focus: ring/outline appears 120ms
Modal enter: fade + scale from 0.95, 200ms ease-out
Modal exit: fade + scale to 0.95, 150ms ease-in

## Anti-Patterns
- 300-600ms on hover/buttons (sluggish)
- Linear easing (robotic)
- Everything animates at once (no hierarchy)
- Infinite loops in product screens (distracting)
- NEVER use transition: all — list properties explicitly
- Bounce/spring that doesn't settle ("jello")
- Animation for animation's sake

## Reduced Motion
Always provide prefers-reduced-motion variant. Replace slide+fade with fade only.

Motion is restraint. Fast, purposeful, accessible.`;
