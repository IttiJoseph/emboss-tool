import type { TextSource } from './types';

export function fontString(s: TextSource): string {
  return `${s.weight} ${s.size}px "${s.family}"`;
}

/** Waits for the webfont so the first rasterization isn't done in a fallback face. */
export async function ensureFont(s: TextSource): Promise<void> {
  try {
    await document.fonts.load(fontString(s), s.text || 'A');
  } catch {
    // Fall through and draw with whatever face is available.
  }
}

export function rasterizeText(canvas: HTMLCanvasElement, s: TextSource): void {
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#fff';
  ctx.font = fontString(s);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lines = s.text.split('\n');
  const lh = s.size * s.lineHeight;
  const y0 = height / 2 - ((lines.length - 1) * lh) / 2;
  lines.forEach((line, i) => ctx.fillText(line, width / 2, y0 + i * lh));
}
