import { Slider } from './Slider';

export type SlotKind = 'color' | 'roughness' | 'height';

export interface TextureSlot {
  name: string;
  canvas: HTMLCanvasElement;
}

export type TextureSet = Partial<Record<SlotKind, TextureSlot>>;

const SLOTS: { kind: SlotKind; label: string; hint: string }[] = [
  { kind: 'color', label: 'Color', hint: 'Base color / albedo' },
  { kind: 'roughness', label: 'Roughness', hint: 'Optional' },
  { kind: 'height', label: 'Height', hint: 'Optional, or displacement' },
];

interface Props {
  set: TextureSet;
  delight: number;
  tile: number;
  onPick: (kind: SlotKind, file: File) => void;
  onClear: (kind: SlotKind) => void;
  onDelight: (v: number) => void;
  onTile: (v: number) => void;
}

export function TextureSlots({ set, delight, tile, onPick, onClear, onDelight, onTile }: Props) {
  return (
    <div className="texture-slots">
      {SLOTS.map(({ kind, label, hint }) => {
        const slot = set[kind];
        const disabled = kind !== 'color' && !set.color;
        return (
          <div key={kind} className={`slot${disabled ? ' disabled' : ''}`}>
            <span className="slot-label">{label}</span>
            {slot ? (
              <>
                <span className="slot-name" title={slot.name}>
                  {slot.name}
                </span>
                <button type="button" className="slot-clear" onClick={() => onClear(kind)}>
                  Remove
                </button>
              </>
            ) : (
              <label className="slot-pick">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={disabled}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onPick(kind, file);
                    e.target.value = '';
                  }}
                />
                <span>{hint}</span>
              </label>
            )}
          </div>
        );
      })}
      {set.color && (
        <>
          <Slider label="Remove baked lighting" value={delight} min={0} max={1} step={0.05} onChange={onDelight} />
          <Slider label="Texture scale" value={tile} min={128} max={2160} step={16} unit="px" onChange={onTile} />
        </>
      )}
    </div>
  );
}
