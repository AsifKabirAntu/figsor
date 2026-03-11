export const CRAFT_DETAILS_MD = `# Craft Details Guide

Implementation details that separate polished products from rough ones.

## 1. Focus States
Use :focus-visible, NOT :focus. Shows focus ring only on keyboard navigation.
NEVER remove focus without replacement. Use box-shadow ring as custom focus indicator.
For groups: use :focus-within on parent.

## 2. Forms
Use correct input types for mobile keyboards: type="email", type="tel", type="url".
Set autocomplete attributes: email, current-password, new-password, name, tel, street-address, cc-number.
NEVER block paste. Disable spellcheck on emails, codes, usernames, URLs.
Labels must be clickable (for= attribute or wrapping).
Placeholders end with ellipsis and show format: "name@company.com..."
Error handling: inline errors, focus first error on submit, aria-invalid and aria-describedby.

## 3. Images
Always set width/height to prevent layout shift. Above fold: fetchpriority="high". Below fold: loading="lazy".

## 4. Touch & Mobile
Remove 300ms tap delay: touch-action: manipulation.
Modal scroll lock: overscroll-behavior: contain.
AutoFocus: desktop only, avoid on mobile (opens keyboard).

## 5. Performance
Virtualize lists with 50+ items. Avoid layout reads in render. Prefer uncontrolled inputs.
Preconnect to CDNs. Preload critical fonts.

## 6. Accessibility
Use semantic elements (button not div, a not span). Keyboard handlers on custom elements.
Proper heading hierarchy (h1 > h2 > h3, no skipping). Scroll-margin-top for fixed headers.
Async updates need role="status" aria-live="polite".

## 7. Navigation
URL should reflect app state (filters, tabs, pagination in URL).
Use proper links (not onClick navigation) for Cmd+click support.
Destructive actions need confirmation or undo window.

## 8. Content Copy
Active voice. Title Case for headings/buttons. Numerals for counts.
Specific labels ("Save API Key" not "Continue"). Error messages include fix.
Second person ("Your account" not "My account").

## Anti-Patterns
- user-scalable=no (disables zoom)
- onPaste preventDefault (blocks paste)
- transition: all (performance killer)
- outline: none without replacement
- div for navigation (use a or Link)
- span/div as buttons (use button)
- Images without width/height (causes CLS)
- Form inputs without labels
- Icon buttons without aria-label

Details matter. These patterns are the difference between "works" and "feels right."`;
