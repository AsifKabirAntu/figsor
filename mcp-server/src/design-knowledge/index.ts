/**
 * Design Craft Knowledge — Based on Refero Design Skill (MIT licensed)
 * https://github.com/referodesign/refero_skill
 *
 * Bundled into Figsor so the AI agent has professional design knowledge
 * available through MCP resources and tools.
 */

export { SKILL_MD } from "./skill.js";
export { TYPOGRAPHY_MD } from "./typography.js";
export { COLOR_MD } from "./color.js";
export { MOTION_MD } from "./motion.js";
export { ICONS_MD } from "./icons.js";
export { CRAFT_DETAILS_MD } from "./craft-details.js";
export { ANTI_AI_SLOP_MD } from "./anti-ai-slop.js";
export { EXAMPLE_WORKFLOW_MD } from "./example-workflow.js";

export const DESIGN_GUIDES = {
  "skill": { name: "Design Methodology", description: "Research-First design methodology — discovery, research, analysis, design, implementation workflow with anti-AI-slop rules" },
  "typography": { name: "Typography Guide", description: "Type scale, font pairing, weight, line-height, letter-spacing (ALL CAPS, small text, headings), responsive type, text color system" },
  "color": { name: "Color Guide", description: "Palette structure (neutrals, primary, semantic, effects), 60/30/10 rule, dark theme, contrast, tokens, anti-indigo rules" },
  "motion": { name: "Motion Guide", description: "Micro-interactions, timing (90-500ms by purpose), easing curves, reduced motion, animation tokens" },
  "icons": { name: "Icons Guide", description: "Sizing, optical corrections, style consistency (outline vs solid), icon+text pairing, accessibility, libraries" },
  "craft-details": { name: "Craft Details Guide", description: "Focus states, forms, images, touch/mobile, performance patterns, accessibility, navigation, content copy rules" },
  "anti-ai-slop": { name: "Anti-AI-Slop Manifesto", description: "What makes designs look AI-generated and how to avoid it — no default indigo, no blob backgrounds, intentional choices" },
  "example-workflow": { name: "Example Workflow", description: "Complete walkthrough of the Research-First methodology applied to a SaaS churn reduction project" },
} as const;
