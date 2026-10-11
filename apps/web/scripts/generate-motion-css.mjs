import { writeFile } from 'node:fs/promises';
import { DURATION, EASE } from '../src/shared/motion/tokens.ts';
const css = `/* Generated from tokens.ts by npm run motion:css. Do not edit timings here. */
@import "./keyframes.css";
:root {
${Object.entries(EASE).map(([key, value]) => `  --ease-${key.replace(/[A-Z]/g, c => '-'+c.toLowerCase())}: cubic-bezier(${value.join(', ')});`).join('\n')}
${Object.entries(DURATION).map(([key, value]) => `  --dur-${key.replace(/[A-Z]/g, c => '-'+c.toLowerCase())}: ${value}s;`).join('\n')}
  --motion-duration-micro: var(--dur-micro);
  --motion-duration-component: var(--dur-overlay);
  --motion-duration-page: var(--dur-page);
  --motion-ease-out: var(--ease-out);
  --motion-ease-spring: var(--ease-emphasized);
}
/* Motion owns these controls' transform; CSS retains the incumbent colors/borders. */
[data-motion-control] { transition-property: background-color, border-color, color, opacity !important; }
.motion-tooltip { position: fixed; z-index: 1000; pointer-events: none; max-width: 240px; padding: 7px 11px; border-radius: 12px; color: var(--text, #17213b); background: var(--bg-card, #edf2f8); border: 1px solid var(--border, #b9c5d5); box-shadow: 0 4px 16px #17213b1c; font: 12px/1.4 Inter, sans-serif; }
.motion-tooltip kbd { margin-left: 6px; opacity: .7; }
`;
await writeFile(new URL('../src/shared/motion/motion.css', import.meta.url), css);
