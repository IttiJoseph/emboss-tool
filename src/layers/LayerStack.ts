import { rasterizeText } from './rasterize';
import type { Layer, TextLayer, TextSource } from './types';

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

let nextId = 1;

/**
 * Owns the layers and the composited height canvas (black = flat, white = raised).
 * Stage 1 recomposites the whole stack; the dirty-layer-plus-above cache lands
 * with the layer panel in stage 3.
 */
export class LayerStack {
  readonly layers: Layer[] = [];
  readonly height: HTMLCanvasElement;
  private heightCtx: CanvasRenderingContext2D;

  constructor(readonly width: number, readonly heightPx: number) {
    this.height = makeCanvas(width, heightPx);
    this.heightCtx = this.height.getContext('2d', { willReadFrequently: false })!;
  }

  addText(source: TextSource): TextLayer {
    const layer: TextLayer = {
      id: `layer-${nextId++}`,
      kind: 'text',
      visible: true,
      opacity: 1,
      mode: 'emboss',
      canvas: makeCanvas(this.width, this.heightPx),
      source,
    };
    rasterizeText(layer.canvas, source);
    this.layers.push(layer);
    return layer;
  }

  updateText(layer: TextLayer, source: TextSource): void {
    layer.source = source;
    rasterizeText(layer.canvas, source);
  }

  composite(): HTMLCanvasElement {
    const ctx = this.heightCtx;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.width, this.heightPx);
    for (const layer of this.layers) {
      if (!layer.visible || layer.opacity <= 0) continue;
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(layer.canvas, 0, 0);
    }
    ctx.globalAlpha = 1;
    return this.height;
  }
}
