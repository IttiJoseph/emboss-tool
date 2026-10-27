import { IMAGE_KIND, type Imperfections, type MaterialPreset } from '../materials/presets';
import { blurFrag, imperfFrag, lightFrag, materialFrag, quadVert } from './shaders';

export interface MaterialImages {
  color: HTMLCanvasElement;
  roughness?: HTMLCanvasElement;
  height?: HTMLCanvasElement;
}

export interface RenderParams {
  depth: number; // px
  softness: number; // gaussian sigma, px
  grain: number; // material grain height, px
  light: { x: number; y: number; z: number }; // x,y: 0..1 canvas space (y down); z: canvas widths
  material: MaterialPreset;
  image: { delight: number; tile: number } | null; // set to use the uploaded images
  imperfections: Imperfections;
  seed: number;
}

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
}

interface ImageSet {
  color: WebGLTexture;
  roughness: WebGLTexture | null;
  height: WebGLTexture | null;
  w: number;
  h: number;
}

type Uniforms = Record<string, WebGLUniformLocation | null>;

// The halo blur runs at 1/8 resolution, sampling a mip of the height texture.
const WIDE_SCALE = 8;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(s)}`);
  }
  return s;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string, names: string[]) {
  const p = gl.createProgram()!;
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`Program link failed: ${gl.getProgramInfoLog(p)}`);
  }
  const u: Uniforms = {};
  for (const n of names) u[n] = gl.getUniformLocation(p, n);
  return { p, u };
}

function texParams(gl: WebGL2RenderingContext, minFilter: number = gl.LINEAR, wrap: number = gl.CLAMP_TO_EDGE) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
}

/**
 * Passes per frame:
 *   height -> narrow blur (bevel, with edge wear) -> relief
 *   height mip -> wide blur at 1/8 res -> halo field
 *   relief + halo + material + imperfection noise -> lit image
 * Material textures and imperfection noise are baked only when their inputs change.
 * Blur targets are R16F when renderable so normals from soft bevels don't band.
 */
export class Renderer {
  private gl: WebGL2RenderingContext;
  private vao: WebGLVertexArrayObject;
  private heightTex: WebGLTexture;
  private narrow: [Target, Target];
  private wide: [Target, Target];
  private wideW: number;
  private wideH: number;
  private blur: { p: WebGLProgram; u: Uniforms };
  private light: { p: WebGLProgram; u: Uniforms };
  private bake: { p: WebGLProgram; u: Uniforms };
  private imperf: { p: WebGLProgram; u: Uniforms };
  private albedoTex: WebGLTexture;
  private surfaceTex: WebGLTexture;
  private materialFbo: WebGLFramebuffer;
  private imperfA: WebGLTexture;
  private imperfB: WebGLTexture;
  private imperfFbo: WebGLFramebuffer;
  private images: ImageSet | null = null;
  private imageVersion = 0;
  private bakedMaterialKey = '';
  private bakedSeed = NaN;

  constructor(canvas: HTMLCanvasElement, readonly width: number, readonly height: number) {
    canvas.width = width;
    canvas.height = height;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;

    this.vao = gl.createVertexArray()!;
    this.blur = program(gl, quadVert, blurFrag, [
      'uSrc', 'uWarpTex', 'uDir', 'uRes', 'uSigma', 'uLod', 'uWarp',
    ]);
    this.light = program(gl, quadVert, lightFrag, [
      'uHeight', 'uAlbedoTex', 'uSurfaceTex', 'uWide', 'uImperfA', 'uImperfB', 'uRes', 'uWideRes',
      'uDepth', 'uGrain', 'uLight', 'uMetallic', 'uSpecular', 'uAniso',
      'uHalo', 'uUneven', 'uWave', 'uCracks', 'uChips', 'uBurnish', 'uDarken',
    ]);
    this.bake = program(gl, quadVert, materialFrag, [
      'uRes', 'uKind', 'uColorImg', 'uRoughImg', 'uHeightImg', 'uImgSize', 'uTile', 'uDelight',
      'uLowLod', 'uBaseRough', 'uHasRough', 'uHasHeight',
    ]);
    this.imperf = program(gl, quadVert, imperfFrag, ['uRes', 'uSeed']);

    const levels = Math.floor(Math.log2(Math.max(width, height))) + 1;
    this.heightTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
    texParams(gl, gl.LINEAR_MIPMAP_LINEAR);
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.R8, width, height);

    const float = !!gl.getExtension('EXT_color_buffer_float');
    const fmt = float ? gl.R16F : gl.RGBA8;
    this.wideW = Math.ceil(width / WIDE_SCALE);
    this.wideH = Math.ceil(height / WIDE_SCALE);
    this.narrow = [this.makeTarget(fmt, width, height), this.makeTarget(fmt, width, height)];
    this.wide = [this.makeTarget(fmt, this.wideW, this.wideH), this.makeTarget(fmt, this.wideW, this.wideH)];

    this.albedoTex = this.makeTexture(gl.RGBA8, width, height);
    this.surfaceTex = this.makeTexture(gl.RGBA8, width, height);
    this.materialFbo = this.makeMrt(this.albedoTex, this.surfaceTex);
    this.imperfA = this.makeTexture(gl.RGBA8, width, height);
    this.imperfB = this.makeTexture(gl.RGBA8, width, height);
    this.imperfFbo = this.makeMrt(this.imperfA, this.imperfB);
  }

  private makeTexture(format: number, w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    texParams(gl);
    gl.texStorage2D(gl.TEXTURE_2D, 1, format, w, h);
    return tex;
  }

  private makeTarget(format: number, w: number, h: number): Target {
    const gl = this.gl;
    const tex = this.makeTexture(format, w, h);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo };
  }

  private makeMrt(a: WebGLTexture, b: WebGLTexture): WebGLFramebuffer {
    const gl = this.gl;
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, a, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, b, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fbo;
  }

  private bindTex(unit: number, tex: WebGLTexture): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  private uploadImage(src: HTMLCanvasElement): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    texParams(gl, gl.LINEAR_MIPMAP_LINEAR, gl.REPEAT);
    return tex;
  }

  private freeImages(): void {
    if (!this.images) return;
    const gl = this.gl;
    gl.deleteTexture(this.images.color);
    if (this.images.roughness) gl.deleteTexture(this.images.roughness);
    if (this.images.height) gl.deleteTexture(this.images.height);
    this.images = null;
  }

  /** Replaces the uploaded material images; null goes back to the procedural presets. */
  setMaterialImages(imgs: MaterialImages | null): void {
    this.freeImages();
    this.imageVersion++;
    if (!imgs) return;
    this.images = {
      color: this.uploadImage(imgs.color),
      roughness: imgs.roughness ? this.uploadImage(imgs.roughness) : null,
      height: imgs.height ? this.uploadImage(imgs.height) : null,
      w: imgs.color.width,
      h: imgs.color.height,
    };
  }

  uploadHeight(source: HTMLCanvasElement): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RED, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  private bakeMaterial(p: RenderParams, key: string): void {
    const gl = this.gl;
    const u = this.bake.u;
    const img = p.image && this.images;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.materialFbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.bake.p);
    gl.uniform2f(u.uRes, this.width, this.height);
    gl.uniform1i(u.uColorImg, 0);
    gl.uniform1i(u.uRoughImg, 1);
    gl.uniform1i(u.uHeightImg, 2);
    if (img && p.image) {
      this.bindTex(0, img.color);
      this.bindTex(1, img.roughness ?? img.color);
      this.bindTex(2, img.height ?? img.color);
      gl.uniform1i(u.uKind, IMAGE_KIND);
      gl.uniform2f(u.uImgSize, img.w, img.h);
      gl.uniform1f(u.uTile, p.image.tile);
      gl.uniform1f(u.uDelight, p.image.delight);
      gl.uniform1f(u.uLowLod, Math.max(0, Math.log2(Math.max(img.w, img.h)) - 4));
      gl.uniform1f(u.uBaseRough, p.material.roughness);
      gl.uniform1i(u.uHasRough, img.roughness ? 1 : 0);
      gl.uniform1i(u.uHasHeight, img.height ? 1 : 0);
    } else {
      // The image samplers are unused here, but whatever is bound to them must not be one
      // of this pass's render targets, or WebGL rejects the draw as a feedback loop.
      for (const unit of [0, 1, 2]) this.bindTex(unit, this.heightTex);
      gl.uniform1i(u.uKind, p.material.kind);
      gl.uniform1i(u.uHasRough, 0);
      gl.uniform1i(u.uHasHeight, 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.bakedMaterialKey = key;
  }

  private bakeImperfections(seed: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.imperfFbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.imperf.p);
    gl.uniform2f(this.imperf.u.uRes, this.width, this.height);
    gl.uniform1f(this.imperf.u.uSeed, seed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.bakedSeed = seed;
  }

  private blurPass(target: Target, src: WebGLTexture, dirX: number, lod: number, warp: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    this.bindTex(0, src);
    gl.uniform2f(this.blur.u.uDir, dirX, 1 - dirX);
    gl.uniform1f(this.blur.u.uLod, lod);
    gl.uniform1f(this.blur.u.uWarp, warp);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  render(p: RenderParams): void {
    const gl = this.gl;
    const { width: w, height: h } = this;
    const im = p.imperfections;
    gl.bindVertexArray(this.vao);

    const key = p.image && this.images
      ? `img:${this.imageVersion}:${p.material.id}:${p.image.delight}:${p.image.tile}`
      : `proc:${p.material.kind}`;
    if (key !== this.bakedMaterialKey) this.bakeMaterial(p, key);
    if (p.seed !== this.bakedSeed) this.bakeImperfections(p.seed);

    const bu = this.blur.u;
    gl.useProgram(this.blur.p);
    gl.uniform1i(bu.uSrc, 0);
    gl.uniform1i(bu.uWarpTex, 1);
    this.bindTex(1, this.imperfB);

    // Bevel. A small floor on sigma keeps rasterized edges from stair-stepping in the normals.
    gl.viewport(0, 0, w, h);
    gl.uniform2f(bu.uRes, w, h);
    gl.uniform1f(bu.uSigma, Math.max(p.softness, 0.6));
    this.blurPass(this.narrow[0], this.heightTex, 1, 0, im.edgeWear);
    this.blurPass(this.narrow[1], this.narrow[0].tex, 0, 0, 0);

    // Halo field.
    gl.viewport(0, 0, this.wideW, this.wideH);
    gl.uniform2f(bu.uRes, this.wideW, this.wideH);
    gl.uniform1f(bu.uSigma, Math.max(im.spread / WIDE_SCALE, 0.75));
    this.blurPass(this.wide[0], this.heightTex, 1, Math.log2(WIDE_SCALE), 0);
    this.blurPass(this.wide[1], this.wide[0].tex, 0, 0, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    this.bindTex(0, this.narrow[1].tex);
    this.bindTex(1, this.albedoTex);
    this.bindTex(2, this.surfaceTex);
    this.bindTex(3, this.wide[1].tex);
    this.bindTex(4, this.imperfA);
    this.bindTex(5, this.imperfB);

    const u = this.light.u;
    const m = p.material;
    gl.useProgram(this.light.p);
    gl.uniform1i(u.uHeight, 0);
    gl.uniform1i(u.uAlbedoTex, 1);
    gl.uniform1i(u.uSurfaceTex, 2);
    gl.uniform1i(u.uWide, 3);
    gl.uniform1i(u.uImperfA, 4);
    gl.uniform1i(u.uImperfB, 5);
    gl.uniform2f(u.uRes, w, h);
    gl.uniform2f(u.uWideRes, this.wideW, this.wideH);
    gl.uniform1f(u.uDepth, p.depth);
    gl.uniform1f(u.uGrain, p.grain);
    gl.uniform3f(u.uLight, p.light.x * w, (1 - p.light.y) * h, p.light.z * w);
    gl.uniform1f(u.uMetallic, m.metallic);
    gl.uniform1f(u.uSpecular, m.specular);
    gl.uniform1f(u.uAniso, m.anisotropy);
    gl.uniform1f(u.uHalo, im.halo);
    gl.uniform1f(u.uUneven, im.uneven);
    gl.uniform1f(u.uWave, im.wave);
    gl.uniform1f(u.uCracks, im.cracks);
    gl.uniform1f(u.uChips, im.chips);
    gl.uniform1f(u.uBurnish, im.burnish);
    gl.uniform1f(u.uDarken, im.darken);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Frees GL objects. The context itself is left alive so a remount can reuse the canvas. */
  dispose(): void {
    const gl = this.gl;
    this.freeImages();
    for (const t of [this.heightTex, this.albedoTex, this.surfaceTex, this.imperfA, this.imperfB]) {
      gl.deleteTexture(t);
    }
    for (const t of [...this.narrow, ...this.wide]) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }
    gl.deleteFramebuffer(this.materialFbo);
    gl.deleteFramebuffer(this.imperfFbo);
    for (const prog of [this.blur, this.light, this.bake, this.imperf]) gl.deleteProgram(prog.p);
    gl.deleteVertexArray(this.vao);
  }
}
