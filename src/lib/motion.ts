/**
 * Motion tokens for JavaScript-driven animation, mirroring the CSS variables in design-system.css. Every animation
 * does one of three jobs: feedback, continuity or hierarchy. No bounce, no transitions on every property, nothing longer
 * than 560ms except the one-time chart draw, and reduced motion turns travel off.
 */
export const DURATION = {
  instant: 120,
  state: 200,
  enter: 320,
  exit: 200,
  section: 560,
  crossfade: 400,
  cycle: 6000,
} as const;

/** cubic-bezier(.16,1,.3,1) sampled as a function, for requestAnimationFrame tweens. */
export function easeOut(t: number): number {
  // Close fit of the enter curve: fast start, long soft landing.
  return 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 4);
}

export const STAGGER = {
  section: 60,
  timeline: 80,
  maxItems: 6,
} as const;
