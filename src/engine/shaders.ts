// Fullscreen triangle from gl_VertexID; no vertex buffers.
export const quadVert = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const noise = /* glsl */ `
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.7);
    a *= 0.5;
  }
  return s / 0.97;
}
// Two octaves only: broad, smooth undulation with no mid-frequency lumps.
float smoothNoise(vec2 p) {
  return (vnoise(p) * 0.67 + vnoise(p * 2.03 + vec2(17.1, 9.7)) * 0.33);
}
// fbm is bunched around 0.5; spread it to use most of 0..1. Smoothstep rather than
// clamp, so fields used as height never get a crease where they saturate.
float stretch(float v) { return smoothstep(0.2, 0.8, v); }
// Distances to the nearest and second-nearest cell centres.
vec2 voronoi(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(x, y);
    vec2 r = g + 0.1 + hash2(i + g) * 0.8 - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return sqrt(vec2(d1, d2));
}`;

// Separable gaussian. Up to 49 taps; wide radii are stepped and lean on linear filtering.
// uLod samples a mip of the source (used when blurring into a low-res target).
// uWarp nudges the sample position by a noise field so outlines wobble like worn edges.
export const blurFrag = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSrc;
uniform sampler2D uWarpTex;
uniform vec2 uDir;   // (1,0) or (0,1)
uniform vec2 uRes;   // target resolution
uniform float uSigma; // target texels
uniform float uLod;
uniform float uWarp; // target texels

void main() {
  vec2 uv = vUv;
  if (uWarp > 0.0) uv += (texture(uWarpTex, vUv).rg * 2.0 - 1.0) * uWarp / uRes;
  float r = ceil(uSigma * 3.0);
  float stepPx = max(1.0, r / 24.0);
  float inv2s2 = 1.0 / (2.0 * uSigma * uSigma);
  float sum = 0.0;
  float wsum = 0.0;
  for (int i = -24; i <= 24; i++) {
    float x = float(i) * stepPx;
    if (abs(x) > r) continue;
    float w = exp(-x * x * inv2s2);
    sum += textureLod(uSrc, uv + uDir * x / uRes, uLod).r * w;
    wsum += w;
  }
  outColor = vec4(sum / wsum, 0.0, 0.0, 1.0);
}`;

// Per-seed noise fields for imperfections, baked once at canvas resolution.
//   A: r = unevenness, g = halo variation, b = sheet waviness, a = crack lines
//   B: rg = edge-wear warp vector, b = chip mask
export const imperfFrag = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
layout(location = 0) out vec4 oA;
layout(location = 1) out vec4 oB;
uniform vec2 uRes;
uniform float uSeed;
${noise}

void main() {
  vec2 p = vUv * uRes;
  vec2 s = vec2(uSeed * 17.13, uSeed * 31.7);

  float uneven = stretch(smoothNoise(p * 0.004 + s));
  float haloVar = stretch(smoothNoise(p * 0.012 + s * 1.3 + 7.0));
  float wave = stretch(smoothNoise(p * 0.003 + s * 0.7 + 19.0));

  // Cracks: meandering ridge lines of warped noise, broken into segments.
  vec2 q = p * 0.006 + s;
  vec2 w = vec2(fbm(q * 2.0), fbm(q * 2.0 + 5.2));
  float ridge = 1.0 - smoothstep(0.0, 0.014, abs(fbm(q + w * 0.8) - 0.5));
  float hair = 1.0 - smoothstep(0.0, 0.006, abs(fbm(p * 0.02 + s + 3.0) - 0.5));
  float seg = smoothstep(0.5, 0.65, stretch(fbm(p * 0.004 + s + 11.0)));
  float crack = max(ridge, hair * 0.5) * seg;

  vec2 warp = vec2(stretch(fbm(p * 0.04 + s + 23.0)), stretch(fbm(p * 0.04 + s + 41.0)));
  float chip = stretch(fbm(p * 0.05 + s + 57.0));

  oA = vec4(uneven, haloVar, wave, crack);
  oB = vec4(warp, chip, 1.0);
}`;

// Material bake, in canvas pixels. Writes albedo and surface via MRT.
// Kinds 0-3 are procedural; kind 4 samples uploaded images.
export const materialFrag = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
layout(location = 0) out vec4 oAlbedo;   // sRGB
layout(location = 1) out vec4 oSurface;  // r: roughness, g: grain height 0..1
uniform vec2 uRes;
uniform int uKind;
uniform sampler2D uColorImg;
uniform sampler2D uRoughImg;
uniform sampler2D uHeightImg;
uniform vec2 uImgSize;
uniform float uTile;      // canvas px covered by one repeat of the image width
uniform float uDelight;   // 0..1
uniform float uLowLod;    // mip used as the baked-lighting estimate
uniform float uBaseRough;
uniform bool uHasRough;
uniform bool uHasHeight;
${noise}

float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec2 p = vUv * uRes;
  vec3 alb;
  float rough, h;

  if (uKind == 4) {
    // Photos carry the lighting they were shot under. Dividing by a heavily blurred
    // copy (a high mip) removes gradients and hotspots but keeps the surface detail.
    vec2 iuv = vec2(p.x / uTile, p.y / (uTile * uImgSize.y / uImgSize.x));
    vec3 c = pow(texture(uColorImg, iuv).rgb, vec3(2.2));
    vec3 low = pow(textureLod(uColorImg, iuv, uLowLod).rgb, vec3(2.2));
    vec3 avg = pow(textureLod(uColorImg, vec2(0.5), 20.0).rgb, vec3(2.2));
    float lowL = max(luma(low), 1e-3);
    float avgL = luma(avg);
    c = mix(c, clamp(c * avgL / lowL, 0.0, 1.0), uDelight);
    alb = pow(c, vec3(1.0 / 2.2));
    // Without a height map, the fine luminance detail stands in for grain.
    float detail = clamp(0.5 + (luma(c) - avgL) / max(avgL, 0.05) * 0.8, 0.0, 1.0);
    h = uHasHeight ? texture(uHeightImg, iuv).r : detail;
    rough = uHasRough ? texture(uRoughImg, iuv).r : uBaseRough + (0.5 - detail) * 0.1;
  } else if (uKind == 0) {
    // Brushed metal: long horizontal streaks, faint large-scale blotching.
    float streak = vnoise(vec2(p.x * 0.004, p.y * 0.7)) * 0.6
                 + vnoise(vec2(p.x * 0.02, p.y * 2.3)) * 0.4;
    float blotch = fbm(p * 0.004);
    alb = vec3(0.80, 0.81, 0.83) * (0.9 + 0.12 * streak) * (0.96 + 0.06 * blotch);
    rough = 0.30 + 0.10 * streak + 0.05 * blotch;
    h = streak;
  } else if (uKind == 1) {
    // Stone: broad mottling, fine tooth, dark specks and shallow pits.
    float m = fbm(p * 0.006);
    float fine = fbm(p * 0.08);
    float speck = step(0.94, hash(floor(p * 0.5)));
    float pits = smoothstep(0.62, 0.75, fbm(p * 0.045 + 3.1));
    alb = mix(vec3(0.50, 0.48, 0.45), vec3(0.72, 0.69, 0.64), m) * (0.9 + 0.15 * fine);
    alb *= 1.0 - 0.3 * speck - 0.2 * pits;
    rough = 0.72 + 0.15 * fine + 0.1 * pits;
    h = clamp(fine * 0.7 + m * 0.4 - pits * 0.5, 0.0, 1.0);
  } else if (uKind == 2) {
    // Cotton paper: fibrous tooth over soft clouding.
    float fib = fbm(vec2(p.x * 0.09, p.y * 0.07));
    float tooth = fbm(p * 0.25);
    float cloud = fbm(p * 0.01);
    alb = vec3(0.94, 0.92, 0.87) * (0.96 + 0.05 * cloud + 0.03 * fib);
    rough = 0.88 + 0.08 * tooth;
    h = tooth * 0.6 + fib * 0.4;
  } else {
    // Pebble-grain leather: domed cells with dark creases between.
    vec2 v = voronoi(p / 11.0 + fbm(p * 0.02) * 1.5);
    float edge = v.y - v.x;
    float crease = 1.0 - smoothstep(0.0, 0.18, edge);
    float pebble = smoothstep(0.0, 0.6, edge);
    float mott = fbm(p * 0.012);
    alb = mix(vec3(0.30, 0.16, 0.09), vec3(0.44, 0.25, 0.14), mott) * (1.0 - 0.35 * crease);
    rough = 0.48 + 0.25 * crease + 0.08 * (1.0 - mott);
    h = pebble * 0.9 + fbm(p * 0.3) * 0.1;
  }

  oAlbedo = vec4(alb, 1.0);
  oSurface = vec4(clamp(rough, 0.0, 1.0), clamp(h, 0.0, 1.0), 0.0, 1.0);
}`;

// All distances are in canvas pixels; relief height 1.0 maps to uDepth pixels.
export const lightFrag = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uHeight;      // bevelled relief 0..1
uniform sampler2D uAlbedoTex;
uniform sampler2D uSurfaceTex;
uniform sampler2D uWide;        // widely blurred relief, low res
uniform sampler2D uImperfA;
uniform sampler2D uImperfB;
uniform vec2 uRes;
uniform vec2 uWideRes;
uniform float uDepth;
uniform float uGrain;     // grain height, px
uniform vec3 uLight;      // point light position, pixels
uniform float uMetallic;
uniform float uSpecular;
uniform float uAniso;
uniform float uHalo;      // px
uniform float uUneven;
uniform float uWave;      // px
uniform float uCracks;
uniform float uChips;
uniform float uBurnish;
uniform float uDarken;

const float PI = 3.14159265;

// Cubic B-spline from 4 bilinear taps; keeps normals of the upsampled halo smooth.
float bicubic(sampler2D t, vec2 uv, vec2 res) {
  vec2 st = uv * res - 0.5;
  vec2 i = floor(st);
  vec2 f = st - i;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = (i - 0.5 + w1 / g0) / res;
  vec2 h1 = (i + 1.5 + w3 / g1) / res;
  return g0.y * (g0.x * texture(t, h0).r + g1.x * texture(t, vec2(h1.x, h0.y)).r)
       + g1.y * (g0.x * texture(t, vec2(h0.x, h1.y)).r + g1.x * texture(t, h1).r);
}

float edgeZone(float r) { return smoothstep(0.08, 0.3, r) * (1.0 - smoothstep(0.7, 0.95, r)); }
float contactOf(float r) { return smoothstep(0.55, 1.0, r); }
float crackOf(float crack, float wide) { return uCracks * crack * smoothstep(0.02, 0.25, wide); }
float chipOf(float r, float chip) { return uChips * edgeZone(r) * smoothstep(0.72, 0.82, chip); }

// The pressed relief alone, with depth varying across the piece. Casts the shadows.
float relief(vec2 uv) {
  return texture(uHeight, uv).r * uDepth * (1.0 + uUneven * (texture(uImperfA, uv).r * 2.0 - 1.0));
}

// Full surface: relief + displaced halo + sheet waviness + grain - cracks - chips.
float surface(vec2 p) {
  vec2 uv = p / uRes;
  float r = texture(uHeight, uv).r;
  vec4 ia = texture(uImperfA, uv);
  float chip = texture(uImperfB, uv).b;
  float wide = bicubic(uWide, uv, uWideRes);
  float h = r * uDepth * (1.0 + uUneven * (ia.r * 2.0 - 1.0));
  h += uHalo * wide * (0.3 + 1.4 * ia.g);
  h += uWave * (ia.b * 2.0 - 1.0);
  h += texture(uSurfaceTex, uv).g * uGrain * (1.0 - 0.8 * uBurnish * contactOf(r));
  h -= crackOf(ia.a, wide) * 4.0;
  h -= chipOf(r, chip) * uDepth * 0.35;
  return h;
}

void main() {
  vec2 p = vUv * uRes;
  float hl = surface(p - vec2(1.0, 0.0));
  float hr = surface(p + vec2(1.0, 0.0));
  float hd = surface(p - vec2(0.0, 1.0));
  float hu = surface(p + vec2(0.0, 1.0));
  vec3 n = normalize(vec3((hl - hr) * 0.5, (hd - hu) * 0.5, 1.0));

  vec3 P = vec3(p, relief(vUv));
  vec3 L = normalize(uLight - P);
  vec3 V = vec3(0.0, 0.0, 1.0);
  float ndl = max(dot(n, L), 0.0);
  float ndv = max(n.z, 1e-3);

  // Soft shadow from the relief only (grain and halo are too shallow to cast at this scale).
  float shadow = 1.0;
  if (ndl > 0.0 && uDepth > 0.5) {
    float tMax = min((uDepth * (1.0 + uUneven) - P.z) / max(L.z, 0.05), 600.0);
    float dt = max(1.0, tMax / 40.0);
    float t = 1.5;
    for (int i = 0; i < 40; i++) {
      if (t > tMax) break;
      vec3 q = P + L * t;
      shadow = min(shadow, clamp(6.0 * (q.z - relief(q.xy / uRes)) / t, 0.0, 1.0));
      if (shadow <= 0.0) break;
      t += dt;
    }
  }

  float r = texture(uHeight, vUv).r;
  float wide = bicubic(uWide, vUv, uWideRes);
  float contact = contactOf(r);
  float crack = crackOf(texture(uImperfA, vUv).a, wide);
  float chip = chipOf(r, texture(uImperfB, vUv).b);

  vec3 alb = pow(texture(uAlbedoTex, vUv).rgb, vec3(2.2));
  vec2 surf = texture(uSurfaceTex, vUv).rg;
  float rough = surf.r;
  // Contact faces: polished by the die, compressed (darker) in leather and paper.
  rough = mix(rough, rough * 0.45, uBurnish * contact);
  alb *= 1.0 - uDarken * contact;
  // Cracks hold grime; chips expose fresher, lighter material.
  alb *= (1.0 - 0.7 * crack) * (1.0 + 0.15 * chip);
  rough = mix(rough, 1.0, crack);

  vec3 F0 = mix(vec3(0.04 * uSpecular), alb, uMetallic);
  vec3 diffC = alb * (1.0 - uMetallic);

  // Anisotropic Ward. Brushing runs along x, so the highlight spreads along y.
  vec3 Hv = normalize(L + V);
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - n * n.x);
  vec3 B = cross(n, T);
  float a = clamp(rough * 0.6, 0.03, 1.0);
  float ax = a * mix(1.0, 0.7, uAniso);
  float ay = a * mix(1.0, 2.2, uAniso);
  float hn = max(dot(n, Hv), 1e-3);
  float e = (pow(dot(Hv, T) / ax, 2.0) + pow(dot(Hv, B) / ay, 2.0)) / (hn * hn);
  float ward = exp(-e) / (4.0 * PI * ax * ay * sqrt(max(ndl * ndv, 1e-4)));
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - max(dot(Hv, V), 0.0), 5.0);
  vec3 direct = (diffC + PI * F * ward) * ndl * shadow * 1.15;

  // Cheap studio environment: soft overhead fill plus a broad lobe toward the light,
  // so metal reads as metal off the highlight.
  vec3 Rv = reflect(-V, n);
  vec3 Lflat = normalize(vec3(L.xy, 0.35));
  float lobe = pow(max(dot(Rv, Lflat), 0.0), mix(24.0, 2.0, rough));
  vec3 env = vec3(0.22 + 0.15 * Rv.z + 0.8 * lobe);
  vec3 Fv = F0 + (1.0 - F0) * pow(1.0 - ndv, 5.0);
  // Occlusion: grain creases, the foot of the relief, and cracks get less ambient light.
  float ao = mix(0.7, 1.0, surf.g) * (1.0 - 0.3 * smoothstep(0.0, 0.5, wide - r)) * (1.0 - 0.5 * crack);
  vec3 ambient = diffC * (0.10 + 0.10 * n.z) + env * Fv;

  vec3 col = direct + ambient * ao;
  col = col / (1.0 + col * 0.25);
  outColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
}`;
