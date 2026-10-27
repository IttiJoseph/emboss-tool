import type { Imperfections } from '../materials/presets';
import { Slider } from './Slider';

type Key = keyof Imperfections;

const FIELDS: { key: Key; label: string; max: number; step: number; unit?: string }[] = [
  { key: 'halo', label: 'Displacement halo', max: 8, step: 0.1, unit: 'px' },
  { key: 'spread', label: 'Halo spread', max: 120, step: 1, unit: 'px' },
  { key: 'uneven', label: 'Uneven depth', max: 0.8, step: 0.05 },
  { key: 'edgeWear', label: 'Edge wear', max: 4, step: 0.1, unit: 'px' },
  { key: 'wave', label: 'Surface waviness', max: 6, step: 0.1, unit: 'px' },
  { key: 'burnish', label: 'Burnish (pressed faces)', max: 1, step: 0.05 },
  { key: 'darken', label: 'Pressure darkening', max: 0.6, step: 0.02 },
  { key: 'cracks', label: 'Cracks', max: 1, step: 0.05 },
  { key: 'chips', label: 'Chipped edges', max: 1, step: 0.05 },
];

interface Props {
  value: Imperfections;
  amount: number;
  onChange: (v: Imperfections) => void;
  onAmount: (v: number) => void;
  onReroll: () => void;
  onReset: () => void;
}

export function ImperfectionPanel({ value, amount, onChange, onAmount, onReroll, onReset }: Props) {
  return (
    <>
      <Slider label="Amount" value={amount} min={0} max={2} step={0.05} onChange={onAmount} />
      <div className="button-row">
        <button type="button" onClick={onReroll}>
          New variation
        </button>
        <button type="button" onClick={onReset}>
          Material defaults
        </button>
      </div>
      <details className="fine-tune">
        <summary>Fine-tune</summary>
        {FIELDS.map((f) => (
          <Slider
            key={f.key}
            label={f.label}
            value={value[f.key]}
            min={f.key === 'spread' ? 8 : 0}
            max={f.max}
            step={f.step}
            unit={f.unit}
            onChange={(v) => onChange({ ...value, [f.key]: v })}
          />
        ))}
      </details>
    </>
  );
}
