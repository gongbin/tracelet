import type { PointerEvent as RPE } from 'react';
import { type SchComponent, type SymbolDef, componentBody, pinGeoms } from '@tracelet/kernel';

const INK = '#7A1F1F';
const SW = 16; // 线宽 mil

function body(sym: SymbolDef, color: string, ghost: boolean) {
  const w = sym.width, h = sym.height;
  const fill = ghost ? 'rgba(61,139,255,.08)' : '#FFFFFF';
  switch (sym.graphic) {
    case 'box':
    case 'resistor':
      return <rect x={0} y={0} width={w} height={h} rx={30} fill={fill} stroke={color} strokeWidth={SW} />;
    case 'capacitor':
      return <path d={`M${w / 2} 0V${h * 0.35}M0 ${h * 0.35}H${w}M0 ${h * 0.65}H${w}M${w / 2} ${h * 0.65}V${h}`} stroke={color} strokeWidth={SW} fill="none" />;
    case 'led':
      return <g stroke={color} strokeWidth={SW} fill="none" strokeLinejoin="round">
        <path d={`M0 ${h / 2}H${w * 0.2}`} /><path d={`M${w * 0.2} ${h * 0.1}L${w * 0.75} ${h / 2}L${w * 0.2} ${h * 0.9}Z`} fill={fill} /><path d={`M${w * 0.75} ${h * 0.1}V${h * 0.9}M${w * 0.75} ${h / 2}H${w}`} />
        <path d={`M${w * 0.55} ${h * 0.05}l60 -70M${w * 0.7} ${h * 0.12}l60 -70`} strokeWidth={SW * 0.7} /></g>;
    case 'gnd':
      return <path d={`M0 0H${w}M${w / 6} 60H${w * 5 / 6}M${w / 3} 120H${w * 2 / 3}`} stroke={color} strokeWidth={SW} fill="none" />;
    case 'power':
      return <path d={`M${w / 4} ${h}H${w * 3 / 4}`} stroke={color} strokeWidth={SW * 1.4} fill="none" />;
  }
}

export interface GlyphProps {
  comp: SchComponent;
  sym: SymbolDef;
  selected?: boolean;
  ghost?: boolean;
  wireMode?: boolean;
  openPins?: Set<string>;
  pinNets?: Map<string, string>;
  highlightNet?: string | null;
  onBodyDown?: (e: RPE<SVGElement>) => void;
  onPinDown?: (pinNumber: string, e: RPE<SVGElement>) => void;
}

export function SymbolGlyph({ comp, sym, selected, ghost, wireMode, openPins, pinNets, highlightNet, onBodyDown, onPinDown }: GlyphProps) {
  const color = ghost ? '#3D8BFF' : sym.color ?? INK;
  const b = componentBody(comp, sym);
  const pins = pinGeoms(comp, sym);
  const big = sym.graphic === 'box' && sym.width >= 1000;
  const cx = b.x + b.w / 2;
  let refPos = { x: b.x + b.w + 80, y: b.y + b.h / 2 - 20, anchor: 'start' as const };
  let valPos = { x: b.x + b.w + 80, y: b.y + b.h / 2 + 110, anchor: 'start' as const };
  if (big) { refPos = { x: cx, y: b.y - 80, anchor: 'start' }; valPos = { x: cx, y: b.y + b.h / 2 + 40, anchor: 'start' }; }
  if (sym.graphic === 'power') valPos = { x: cx, y: b.y + b.h - 60, anchor: 'start' };
  if (sym.graphic === 'gnd') valPos = { x: b.x + b.w + 60, y: b.y + 120, anchor: 'start' };
  const mid = big || sym.graphic === 'power';

  return (
    <g opacity={ghost ? 0.85 : 1} className={ghost ? 'ghost' : undefined}>
      {selected && !ghost && <rect x={b.x - 160} y={b.y - 160} width={b.w + 320} height={b.h + 320} rx={40} fill="rgba(255,216,77,.12)" stroke="#E5B800" strokeWidth={20} />}
      <g transform={`translate(${comp.x} ${comp.y}) rotate(${comp.rotation} ${sym.width / 2} ${sym.height / 2})`}>
        <g onPointerDown={onBodyDown} style={{ cursor: ghost ? 'copy' : 'move' }} strokeDasharray={ghost ? '50 40' : undefined}>
          {body(sym, color, !!ghost)}
          {/* 透明命中区 */}
          <rect x={0} y={0} width={sym.width} height={sym.height} fill="transparent" stroke="none" />
        </g>
      </g>
      {pins.map((g) => {
        const open = openPins?.has(g.def.number);
        const net = pinNets?.get(g.def.number);
        const hl = highlightNet && net === highlightNet;
        return (
          <g key={g.def.number}>
            <path d={`M${g.base.x} ${g.base.y}L${g.end.x} ${g.end.y}`} stroke={color} strokeWidth={SW} />
            {sym.showPinNames && (
              <text x={g.def.side === 'L' ? g.base.x + 60 : g.def.side === 'R' ? g.base.x - 60 : g.base.x} y={g.def.side === 'T' ? g.base.y + 110 : g.def.side === 'B' ? g.base.y - 50 : g.base.y + 40} fontSize={100} fill="#4A4A4A" textAnchor={g.def.side === 'L' ? 'start' : g.def.side === 'R' ? 'end' : 'middle'} pointerEvents="none">{g.def.name}</text>
            )}
            {open && !sym.power && !ghost && <rect x={g.end.x - 30} y={g.end.y - 30} width={60} height={60} fill="#FF3B30" pointerEvents="none" />}
            {hl && <circle cx={g.end.x} cy={g.end.y} r={90} fill="rgba(255,216,77,.35)" stroke="#E5B800" strokeWidth={14} pointerEvents="none" />}
            {!ghost && (
              <circle cx={g.end.x} cy={g.end.y} r={70} fill={wireMode ? 'rgba(61,139,255,.25)' : 'transparent'} stroke={wireMode ? '#3D8BFF' : 'transparent'} strokeWidth={14} style={{ cursor: 'crosshair' }}
                onPointerDown={(e) => onPinDown?.(g.def.number, e)}>
                <title>{`${comp.ref}.${g.def.name}${net ? ' · ' + net : ''}`}</title>
              </circle>
            )}
          </g>
        );
      })}
      {!sym.power && <text x={refPos.x} y={refPos.y} fontSize={120} fontWeight={600} fill={ghost ? '#3D8BFF' : '#201E1D'} textAnchor={mid ? 'middle' : refPos.anchor} pointerEvents="none">{comp.ref}</text>}
      {sym.graphic !== 'gnd' && <text x={valPos.x} y={valPos.y} fontSize={110} fill={ghost ? '#3D8BFF' : sym.color ?? '#4A4A4A'} textAnchor={mid ? 'middle' : valPos.anchor} pointerEvents="none">{comp.value}</text>}
      {sym.graphic === 'gnd' && <text x={valPos.x} y={valPos.y} fontSize={100} fill={sym.color} pointerEvents="none">{comp.value}</text>}
    </g>
  );
}
