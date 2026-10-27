export type LayerMode = 'emboss' | 'deboss';

export interface TextSource {
  text: string;
  family: string;
  weight: number;
  size: number; // px at canvas resolution
  lineHeight: number; // multiple of size
}

interface LayerBase {
  id: string;
  visible: boolean;
  opacity: number;
  mode: LayerMode;
  // Grayscale coverage: white = raised. Transparent elsewhere.
  canvas: HTMLCanvasElement;
}

export interface TextLayer extends LayerBase {
  kind: 'text';
  source: TextSource;
}

// Brush and image layers arrive in stages 4 and 5.
export type Layer = TextLayer;
