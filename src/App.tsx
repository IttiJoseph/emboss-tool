import { useCallback, useEffect, useRef, useState } from 'react';
import { Renderer, type RenderParams } from './engine/Renderer';
import { LayerStack } from './layers/LayerStack';
import { ensureFont } from './layers/rasterize';
import type { TextLayer, TextSource } from './layers/types';
import { loadImageCanvas } from './materials/loadImage';
import { MATERIALS, type Imperfections, type MaterialPreset } from './materials/presets';
import { ImperfectionPanel } from './ui/ImperfectionPanel';
import { Slider } from './ui/Slider';
import { TextureSlots, type SlotKind, type TextureSet } from './ui/TextureSlots';

const SIZE = 1080;

const FONTS = ['Playfair Display', 'DM Serif Display', 'Inter', 'Bebas Neue'];
const WEIGHTS = [400, 700, 900];

const DEFAULT_TEXT: TextSource = {
  text: 'Emboss',
  family: 'Playfair Display',
  weight: 900,
  size: 210,
  lineHeight: 1.05,
};

const DEFAULT_LIGHT = { x: 0.2, y: 0.18, z: 0.45 };

const NO_TEXTURES: TextureSet = {};

function scaleImperfections(im: Imperfections, amount: number): Imperfections {
  const out = { ...im };
  for (const k of Object.keys(out) as (keyof Imperfections)[]) {
    if (k !== 'spread') out[k] *= amount;
  }
  return out;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const stackRef = useRef<LayerStack | null>(null);
  const layerRef = useRef<TextLayer | null>(null);
  const paramsRef = useRef<RenderParams | null>(null);
  const frameRef = useRef(0);

  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState<TextSource>(DEFAULT_TEXT);
  const [depth, setDepth] = useState(14);
  const [softness, setSoftness] = useState(3);
  const [light, setLight] = useState(DEFAULT_LIGHT);
  const [material, setMaterial] = useState<MaterialPreset>(MATERIALS[0]);
  const [grain, setGrain] = useState(MATERIALS[0].grain);
  const [textures, setTextures] = useState<Record<string, TextureSet>>({});
  const [delight, setDelight] = useState(0.8);
  const [tile, setTile] = useState(SIZE);
  const [imperf, setImperf] = useState<Imperfections>(MATERIALS[0].imperfections);
  const [amount, setAmount] = useState(1);
  const [seed, setSeed] = useState(1);
  const [dragging, setDragging] = useState(false);

  // Renders on demand, coalesced to at most one draw per animation frame.
  const schedule = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      if (rendererRef.current && paramsRef.current) rendererRef.current.render(paramsRef.current);
    });
  }, []);

  useEffect(() => {
    let renderer: Renderer;
    try {
      renderer = new Renderer(canvasRef.current!, SIZE, SIZE);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    rendererRef.current = renderer;
    stackRef.current = new LayerStack(SIZE, SIZE);
    return () => {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      renderer.dispose();
      rendererRef.current = null;
      stackRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    ensureFont(text).then(() => {
      const stack = stackRef.current;
      const renderer = rendererRef.current;
      if (cancelled || !stack || !renderer) return;
      if (layerRef.current) stack.updateText(layerRef.current, text);
      else layerRef.current = stack.addText(text);
      renderer.uploadHeight(stack.composite());
      schedule();
    });
    return () => {
      cancelled = true;
    };
  }, [text, schedule]);

  const texSet = textures[material.id] ?? NO_TEXTURES;

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const { color, roughness, height } = texSet;
    renderer.setMaterialImages(
      color ? { color: color.canvas, roughness: roughness?.canvas, height: height?.canvas } : null,
    );
    schedule();
  }, [texSet, schedule]);

  useEffect(() => {
    paramsRef.current = {
      depth,
      softness,
      grain,
      light,
      material,
      image: texSet.color ? { delight, tile } : null,
      imperfections: scaleImperfections(imperf, amount),
      seed,
    };
    schedule();
  }, [depth, softness, grain, light, material, texSet, delight, tile, imperf, amount, seed, schedule]);

  const pickTexture = async (kind: SlotKind, file: File) => {
    const id = material.id;
    try {
      const canvas = await loadImageCanvas(file);
      setTextures((t) => ({ ...t, [id]: { ...t[id], [kind]: { name: file.name, canvas } } }));
    } catch {
      setError(`Couldn't read ${file.name} as an image.`);
    }
  };

  const clearTexture = (kind: SlotKind) => {
    const id = material.id;
    setTextures((t) => {
      // Removing the color image drops the optional maps too; they only make sense with it.
      const next: TextureSet = kind === 'color' ? {} : { ...t[id] };
      delete next[kind];
      return { ...t, [id]: next };
    });
  };

  const selectMaterial = (m: MaterialPreset) => {
    setMaterial(m);
    setGrain(m.grain);
    setImperf(m.imperfections);
  };

  const moveLight = (e: React.PointerEvent) => {
    const rect = stageRef.current!.getBoundingClientRect();
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    setLight((l) => ({
      ...l,
      x: clamp((e.clientX - rect.left) / rect.width),
      y: clamp((e.clientY - rect.top) / rect.height),
    }));
  };

  const patchText = (patch: Partial<TextSource>) => setText((t) => ({ ...t, ...patch }));

  return (
    <div className="app">
      <main className="viewport">
        <div className="stage" ref={stageRef}>
          <canvas ref={canvasRef} className="gl" />
          <div
            className={`light-handle${dragging ? ' dragging' : ''}`}
            style={{ left: `${light.x * 100}%`, top: `${light.y * 100}%` }}
            title="Drag to move the light"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setDragging(true);
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) moveLight(e);
            }}
            onPointerUp={() => setDragging(false)}
            onPointerCancel={() => setDragging(false)}
          />
          {error && <div className="error">{error}</div>}
        </div>
      </main>

      <aside className="panel">
        <h1>Emboss</h1>

        <section>
          <h2>Material</h2>
          <div className="swatches">
            {MATERIALS.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`swatch${m.id === material.id ? ' active' : ''}`}
                aria-pressed={m.id === material.id}
                onClick={() => selectMaterial(m)}
              >
                <span className="swatch-chip" style={{ background: m.swatch }} />
                {m.name}
              </button>
            ))}
          </div>
          <Slider label="Grain" value={grain} min={0} max={4} step={0.1} unit="px" onChange={setGrain} />
          <h3>Your texture images</h3>
          <TextureSlots
            set={texSet}
            delight={delight}
            tile={tile}
            onPick={pickTexture}
            onClear={clearTexture}
            onDelight={setDelight}
            onTile={setTile}
          />
        </section>

        <section>
          <h2>Imperfections</h2>
          <ImperfectionPanel
            value={imperf}
            amount={amount}
            onChange={setImperf}
            onAmount={setAmount}
            onReroll={() => setSeed((s) => s + 1)}
            onReset={() => {
              setImperf(material.imperfections);
              setAmount(1);
            }}
          />
        </section>

        <section>
          <h2>Text</h2>
          <label className="field">
            <span className="field-row">Content</span>
            <textarea
              rows={2}
              value={text.text}
              onChange={(e) => patchText({ text: e.target.value })}
            />
          </label>
          <div className="field-pair">
            <label className="field">
              <span className="field-row">Font</span>
              <select value={text.family} onChange={(e) => patchText({ family: e.target.value })}>
                {FONTS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-row">Weight</span>
              <select
                value={text.weight}
                onChange={(e) => patchText({ weight: Number(e.target.value) })}
              >
                {WEIGHTS.map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Slider
            label="Size"
            value={text.size}
            min={40}
            max={600}
            unit="px"
            onChange={(size) => patchText({ size })}
          />
        </section>

        <section>
          <h2>Relief</h2>
          <Slider label="Depth" value={depth} min={0} max={60} step={0.5} unit="px" onChange={setDepth} />
          <Slider
            label="Bevel softness"
            value={softness}
            min={0.5}
            max={30}
            step={0.5}
            unit="px"
            onChange={setSoftness}
          />
        </section>

        <section>
          <h2>Light</h2>
          <Slider
            label="Height"
            value={light.z}
            min={0.05}
            max={1.5}
            step={0.05}
            onChange={(z) => setLight((l) => ({ ...l, z }))}
          />
          <p className="hint">Drag the light on the canvas. Lower it for raking light.</p>
          <button type="button" onClick={() => setLight(DEFAULT_LIGHT)}>
            Reset light
          </button>
        </section>
      </aside>
    </div>
  );
}
