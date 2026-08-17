/**
 * Waits a randomized amount of time between minMs and maxMs.
 * Used between scroll/pagination actions to behave like a human and avoid
 * hammering the site — not to defeat any bot-detection, just to be polite.
 */
export function humanDelay(minMs = 1200, maxMs = 2800) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}
