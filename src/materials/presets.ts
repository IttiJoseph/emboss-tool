/**
 * Physical side effects of pressing or carving a relief, all applied on the GPU.
 * Distances are canvas px; the rest are 0..1 strengths.
 */
export interface Imperfections {
  halo: number; // surrounding material dragged up around the relief, px
  spread: number; // how far the halo reaches, px
  uneven: number; // depth varies across the piece (die pressure, chisel)
  edgeWear: number; // wobble of the relief outline, px
  wave: number; // large-scale waviness of the sheet, px
  cracks: number; // hairline cracks near the relief (stone)
  chips: number; // broken-off bits along edges (stone)
  burnish: number; // contact faces polished smooth, grain flattened
  darken: number; // compressed areas darken (leather, paper)
}

/**
 * A material is baked once on the GPU into two textures at canvas resolution:
 * albedo (sRGB) and surface (R = roughness, G = grain height). `kind` selects
 * the procedural generator in materialFrag; uploaded images replace it.
 */
export interface MaterialPreset {
  id: string;
  name: string;
  kind: number;
  metallic: number;
  specular: number; // dielectric reflectance multiplier (1 = F0 0.04)
  anisotropy: number; // 0 = isotropic; highlight stretches across the brushing
  roughness: number; // used for image textures that come without a roughness map
  grain: number; // default grain height, px
  imperfections: Imperfections;
  swatch: string; // CSS background for the picker
}

export const MATERIALS: MaterialPreset[] = [
  {
    id: 'metal',
    name: 'Brushed metal',
    kind: 0,
    metallic: 1,
    specular: 1,
    anisotropy: 0.8,
    roughness: 0.35,
    grain: 0.4,
    imperfections: {
      halo: 4.5, spread: 32, uneven: 0.25, edgeWear: 0.5, wave: 2,
      cracks: 0, chips: 0, burnish: 0.6, darken: 0,
    },
    swatch: 'repeating-linear-gradient(0deg, #b9bcc2 0 1px, #9fa3aa 1px 2px, #c8cbd0 2px 3px)',
  },
  {
    id: 'stone',
    name: 'Stone',
    kind: 1,
    metallic: 0,
    specular: 0.6,
    anisotropy: 0,
    roughness: 0.8,
    grain: 1.6,
    imperfections: {
      halo: 0, spread: 30, uneven: 0.15, edgeWear: 1.5, wave: 0,
      cracks: 0.7, chips: 0.6, burnish: 0.2, darken: 0,
    },
    swatch: 'radial-gradient(circle at 30% 30%, #b3ada3, #847f77)',
  },
  {
    id: 'paper',
    name: 'Paper',
    kind: 2,
    metallic: 0,
    specular: 0.4,
    anisotropy: 0,
    roughness: 0.9,
    grain: 1.0,
    imperfections: {
      halo: 1.2, spread: 18, uneven: 0.2, edgeWear: 0.4, wave: 0.8,
      cracks: 0, chips: 0, burnish: 0.3, darken: 0.04,
    },
    swatch: 'linear-gradient(135deg, #f4f1ea, #e2ddd2)',
  },
  {
    id: 'leather',
    name: 'Leather',
    kind: 3,
    metallic: 0,
    specular: 1,
    anisotropy: 0,
    roughness: 0.55,
    grain: 1.4,
    imperfections: {
      halo: 1.5, spread: 20, uneven: 0.2, edgeWear: 0.8, wave: 1,
      cracks: 0, chips: 0, burnish: 0.5, darken: 0.25,
    },
    swatch: 'radial-gradient(circle at 30% 30%, #7a4a2c, #48271a)',
  },
];

/** Kind used by materialFrag when sampling uploaded images instead of a generator. */
export const IMAGE_KIND = 4;
