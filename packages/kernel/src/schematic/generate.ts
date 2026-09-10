/**
 * 从结构化抽取结果（AI 识别 PDF / 图片，或手工描述）生成原理图：
 * 自动建通用符号、网格布局、每个已命名引脚接一段短线 + 网络标签，靠标签实现连通性。
 */
import type { Sheet, SymbolDef, PinDef, SchComponent, Wire, NetLabel } from '../model/schematic.js';
import { DEFAULT_FRAME, PAPER_SIZES } from '../model/schematic.js';
import { newId } from '../ids.js';
import { registerSymbols } from '../library/registry.js';
import { getSymbol, findSymbol } from '../library/symbols.js';
import { findFootprint } from '../library/footprints.js';
import { registerFootprints } from '../library/registry.js';
import { footprintFromName } from '../library/generators.js';
import { pinGeoms, snapComponentOrigin, componentBounds, componentBody } from './geometry.js';
import { buildNetlist } from './connectivity.js';
import { segRectDist, type Vec } from '../geometry.js';

export interface ExtractedPin { number: string; name?: string; net?: string; side?: PinDef['side'] }
export interface ExtractedComponent { ref: string; value?: string; kind?: string; footprint?: string; description?: string; pins: ExtractedPin[]; position?: { x: number; y: number } }
export interface ExtractedSchematic { title?: string; components: ExtractedComponent[]; notes?: string[]; preserveNetNames?: boolean }

export interface GenerateResult { sheet: Sheet; symbols: SymbolDef[]; stats: { components: number; labeledPins: number; nets: number } }

const POWER_RE = /^(gnd|vss|agnd|dgnd|pgnd)$/i;
const RAIL_RE = /^(\+?\d+(\.\d+)?v\d*|vcc\w*|vdd\w*|vbus|vin|v_?bat\w*|\+?3v3|\+?5v|avdd|dvdd)$/i;

function kindToBuiltin(c: ExtractedComponent): string | null {
  const k = `${c.kind ?? ''} ${c.value ?? ''} ${c.ref}`.toLowerCase();
  if (c.pins.length !== 2) return null;
  if (/^r\d/i.test(c.ref) || /resistor|电阻/.test(k)) return 'sym:R';
  if (/^l\d/i.test(c.ref) || /inductor|电感/.test(k)) return 'sym:L';
  if (/^sw\d/i.test(c.ref) || /switch|开关/.test(k)) return 'sym:SW';
  if (/^c\d/i.test(c.ref) || /capacitor|电容/.test(k)) return 'sym:C';
  if (/^d\d|^led\d/i.test(c.ref) && /led|发光/.test(k)) return 'sym:LED';
  return null;
}

function footprintFor(c: ExtractedComponent, builtin: string | null): string {
  const fp = (c.footprint ?? '').toLowerCase();
  const size = /0402|0603|0805/.exec(fp)?.[0];
  if (builtin === 'sym:R') return `fp:R_${size ?? '0402'}`;
  if (builtin === 'sym:C') return `fp:C_${size ?? '0402'}`;
  if (builtin === 'sym:LED') return `fp:LED_${size === '0805' ? '0805' : '0603'}`;
  const name = (c.footprint ?? '').trim();
  if (!name) return '';
  // 已知 id / 内置名 → 直接用；KiCad 风格名（LQFP-48_7x7mm_P0.5mm、PinHeader_1x04…）→ 参数化生成
  const direct = findFootprint(name) ?? findFootprint(`fp:${name}`) ?? findFootprint(`fp:gen:${name}`);
  if (direct) return direct.id;
  const gen = footprintFromName(name);
  if (gen) { if (!findFootprint(gen.id)) registerFootprints([gen]); return gen.id; }
  return '';
}

/** 为多引脚元件生成一个盒子符号：引脚前半在左、后半在右，200mil 间距，引脚端点落在 100mil 栅格。 */
function boxSymbol(c: ExtractedComponent): SymbolDef {
  if (c.pins.length === 1 && (/^TP\d/i.test(c.ref) || /test.?point/i.test(c.kind ?? ''))) {
    return {id:`sym:gen:${c.ref}:${newId('s')}`,name:c.value||c.ref,kind:'testpoint',prefix:'TP',width:200,height:200,graphic:'shapes',
      shapes:[{kind:'circle',c:{x:100,y:100},r:90,width:12,fill:'none'}],
      pins:[{number:c.pins[0].number,name:c.pins[0].name??'',side:c.pins[0].side??'B',offset:100,length:200,type:'passive'}],
      showPinNames:false,power:false,defaultValue:c.value??'',defaultFootprint:'',description:'',source:'ai-extract'};
  }
  const n = c.pins.length;
  const groups: Record<PinDef['side'], ExtractedPin[]> = {L:[], R:[], T:[], B:[]};
  c.pins.forEach((p,i) => groups[p.side ?? (i < Math.ceil(n/2) ? 'L' : 'R')].push(p));
  const longest = Math.max(4, ...c.pins.map(p => (p.name ?? p.number).length));
  const width = Math.max(1200, Math.ceil((longest * 2 * 70 + 400) / 200) * 200, 400 * (Math.max(groups.T.length,groups.B.length)+1));
  const height = Math.max(600, 400 * (Math.max(groups.L.length,groups.R.length)+1));
  const pins: PinDef[] = [];
  for(const side of ['L','R','T','B'] as const) groups[side].forEach((p,i) => pins.push({number:p.number,name:p.name??p.number,side,offset:Math.round((side==='L'||side==='R'?height:width)*(i+1)/(groups[side].length+1)/100)*100,length:200,type:pinType(p)}));
  const prefix = c.ref.replace(/\d+$/, '') || 'U';
  return { id: `sym:gen:${c.ref}:${newId('s')}`, name: c.value || c.ref, kind: c.kind || '导入', prefix, width, height, graphic: 'box', pins, showPinNames: true, power: false, defaultValue: c.value ?? '', defaultFootprint: '', description: c.description ?? '', source: 'ai-extract' };
}
function pinType(p: ExtractedPin): PinDef['type'] {
  const n = (p.name ?? '').toLowerCase();
  if (/gnd|vss/.test(n) || /vcc|vdd|3v3|5v|vin|vbus/.test(n)) return 'power_in';
  if (/^(tx|out|do|sdo|miso)/.test(n)) return 'output';
  if (/^(rx|in|di|sdi|mosi|en|rst|reset)/.test(n)) return 'input';
  return 'bidirectional';
}

export function generateSchematic(spec: ExtractedSchematic, opts: { sheetName?: string; sheetId?: string } = {}): GenerateResult {
  if (!spec.components?.length) throw new Error('No components in schematic specification');
  const refs = new Set<string>();
  for (const c of spec.components) {
    if (!c.ref?.trim() || refs.has(c.ref.toUpperCase())) throw new Error(`Missing or duplicate reference: ${c.ref}`);
    refs.add(c.ref.toUpperCase());
    if (!c.pins?.length || c.pins.some(p => !p.number?.trim()) || new Set(c.pins.map(p => p.number)).size !== c.pins.length) throw new Error(`Invalid or duplicate pins: ${c.ref}`);
    if(c.position && (![c.position.x,c.position.y].every(v=>Number.isFinite(v)&&v>=0&&v<=100))) throw new Error(`Invalid source position: ${c.ref}`);
    if(c.pins.some(p=>p.side && !['L','R','T','B'].includes(p.side))) throw new Error(`Invalid pin side: ${c.ref}`);
  }
  const netName = (name: string) => spec.preserveNetNames ? name.trim() : normalizeNet(name);
  const symbols: SymbolDef[] = [];
  const components: SchComponent[] = [];
  const wires: Wire[] = [];
  const labels: NetLabel[] = [];
  const usedRefs = new Set<string>();
  const comps = spec.components.filter((c) => c.ref && c.pins?.length);
  // 布局：按元件宽度自适应换行，行内 800mil 间距
  // 行宽按 A4 内框留出边距；超出时自动选更大的纸张
  const COLS_WIDTH = 10800;
  let x = 800, y = 800, rowH = 0;
  let labeledPins = 0;
  const nets = new Set<string>();
  for (const c of comps) {
    let ref = c.ref; let k = 2; while (usedRefs.has(ref)) ref = `${c.ref}_${k++}`; usedRefs.add(ref);
    const builtin = kindToBuiltin(c);
    let sym: SymbolDef;
    if (builtin && findSymbol(builtin)) {
      const base = getSymbol(builtin);
      const anode = c.pins.find((p) => /^(a|anode|阳极)$/i.test(p.name ?? ''));
      const cathode = c.pins.find((p) => /^(k|cathode|阴极)$/i.test(p.name ?? ''));
      if (builtin === 'sym:LED' && (!anode || !cathode)) {
        // Unknown polarity must not be silently assigned from a library convention.
        sym = boxSymbol({ ...c, ref }); symbols.push(sym); registerSymbols([sym]);
      } else {
        const numbers = builtin === 'sym:LED' ? [anode!.number, cathode!.number] : c.pins.map((p) => p.number);
        if (base.pins.every((p, i) => p.number === numbers[i])) sym = base;
        else {
          sym = { ...base, id: `sym:gen:${ref}:${newId('s')}`, pins: base.pins.map((p, i) => ({ ...p, number: numbers[i] })), source: 'ai-extract' };
          symbols.push(sym); registerSymbols([sym]);
        }
      }
    } else { sym = boxSymbol({ ...c, ref }); symbols.push(sym); registerSymbols([sym]); }
    const w = sym.width + 1400, h = sym.height + 1000;
    if (x + w > COLS_WIDTH && x > 800) { x = 800; y += rowH + 600; rowH = 0; }
    let rotation = 0;
    if (builtin && c.pins[0].side) {
      const angles = {R:0,B:90,L:180,T:270};
      const pin = sym.pins.find(p=>p.number===c.pins[0].number)!;
      rotation = (angles[c.pins[0].side] - angles[pin.side] + 360) % 360;
    }
    const origin = snapComponentOrigin(sym, c.position ? {x:800+c.position.x*120,y:1200+c.position.y*100} : { x: x + w / 2, y: y + h / 2 }, rotation);
    const comp: SchComponent = { id: newId('c'), ref, symbolId: sym.id, value: c.value ?? sym.defaultValue, footprint: footprintFor(c, builtin), x: origin.x, y: origin.y, rotation, mirror: false, props: c.footprint ? { sourceFootprint: c.footprint } : {} };
    components.push(comp);
    const geoms = pinGeoms(comp, sym);
    for (const p of c.pins) {
      if (!p.net) continue;
      const g = geoms.find((gg) => gg.def.number === p.number) ?? geoms.find((gg) => gg.def.name === p.name);
      if (!g) continue;
      const dir: Vec = { x: Math.sign(g.end.x - g.base.x), y: Math.sign(g.end.y - g.base.y) };
      const tip = { x: g.end.x + dir.x * 200, y: g.end.y + dir.y * 200 };
      wires.push({ id: newId('w'), points: [g.end, tip] });
      const net = netName(p.net);
      if (net === 'GND') {
        // 地符号：引脚端点在符号中心上方 300mil
        components.push({ id: newId('c'), ref: `#GND${components.length + 1}`, symbolId: 'sym:GND', value: 'GND', footprint: '', x: tip.x - 150, y: tip.y + 300 - 100, rotation: 0, mirror: false, props: {} });
      } else if (RAIL_RE.test(net) || /^\+/.test(net)) {
        // 电源符号：引脚端点在符号中心下方 300mil
        components.push({ id: newId('c'), ref: `#PWR${components.length + 1}`, symbolId: 'sym:PWR', value: net, footprint: '', x: tip.x - 200, y: tip.y - 300 - 100, rotation: 0, mirror: false, props: {} });
      } else labels.push({ id: newId('l'), text: net, x: tip.x, y: tip.y });
      nets.add(net); labeledPins++;
    }
    const b = componentBounds(comp, sym);
    x += w; rowH = Math.max(rowH, b.h + 600);
  }
  // 选择能容纳内容的最小纸张（右下角标题栏 4400×900 需留空）
  const extent = components.reduce((m, c) => { const b = componentBounds(c); return { x: Math.max(m.x, b.x + b.w), y: Math.max(m.y, b.y + b.h) }; }, { x: 0, y: 0 });
  const paper = (['A4', 'A3', 'A2', 'A1'] as const).find((sz) => extent.x + 600 <= PAPER_SIZES[sz].w - 200 && extent.y + (spec.notes?.length ?? 0) * 200 + 1000 <= PAPER_SIZES[sz].h - 200 - 900) ?? 'A1';
  const sheet: Sheet = { id: opts.sheetId ?? newId('sheet'), name: opts.sheetName ?? spec.title ?? 'AI 识别', frame: { ...DEFAULT_FRAME, size: paper, title: spec.title ?? '' }, components, wires, labels, junctions: [], buses: [], graphics: (spec.notes ?? []).map((t, i) => ({ id: newId('g'), kind: 'text' as const, x: 800, y: extent.y + 400 + i * 200, text: t, size: 100 })) };
  // Reconnect source-positioned components with visible orthogonal wires when safe.
  // Keep labels as a fallback; never accept a wire that changes the electrical graph.
  if (comps.every(c => c.position) && comps.length <= 100) {
    const signature = () => [...buildNetlist(sheet).pinNet].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('|');
    const expected = signature();
    const groups = new Map<string, Vec[]>();
    for (const source of comps) {
      const c = components.find(c=>c.ref===source.ref)!;
      for (const pin of source.pins) {
        if (!pin.net?.trim() || netName(pin.net)==='GND') continue;
        const g = pinGeoms(c).find(g=>g.def.number===pin.number)!;
        const tip = {x:g.end.x+Math.sign(g.end.x-g.base.x)*200,y:g.end.y+Math.sign(g.end.y-g.base.y)*200};
        const net = netName(pin.net); if(!groups.has(net)) groups.set(net,[]); groups.get(net)!.push(tip);
      }
    }
    const bodies = components.filter(c=>!getSymbol(c.symbolId).power).map(c=>componentBody(c));
    for (const points of groups.values()) {
      const connected = points.slice(0,1), pending = points.slice(1);
      while (pending.length) {
        let ai=0,bi=0,distance=Infinity;
        connected.forEach((a,i)=>pending.forEach((b,j)=>{const d=Math.abs(a.x-b.x)+Math.abs(a.y-b.y);if(d<distance){distance=d;ai=i;bi=j;}}));
        const a=connected[ai],b=pending.splice(bi,1)[0];connected.push(b);
        const paths = [[a,{x:b.x,y:a.y},b],[a,{x:a.x,y:b.y},b]];
        for(const path of paths) {
          if(path.slice(1).some((q,i)=>bodies.some(r=>segRectDist(path[i],q,r)<1)))continue;
          const wire={id:newId('w'),points:path};sheet.wires.push(wire);
          if(signature()===expected)break;
          sheet.wires.pop();
        }
      }
    }
  }
  // Verify the generated electrical identity, rather than trusting a non-empty drawing.
  const netlist = buildNetlist(sheet);
  for (const source of comps) {
    const comp = components.find(c=>c.ref===source.ref)!;
    for (const pin of source.pins) {
      if (!pin.net?.trim()) {
        const connected = netlist.nets.find(n=>n.pins.some(p=>p.componentId===comp.id && p.pinNumber===pin.number));
        if (connected && (connected.pins.length>1 || connected.labels.length || connected.powerNames.length)) throw new Error(`Generated net mismatch: ${source.ref}.${pin.number} should be unconnected`);
        continue;
      }
      const actual = netlist.pinNet.get(`${comp.id}:${pin.number}`);
      if (actual !== netName(pin.net)) throw new Error(`Generated net mismatch: ${source.ref}.${pin.number}, expected ${netName(pin.net)}, got ${actual ?? 'unconnected'}. Space out source positions or review extraction.`);
    }
  }
  return { sheet, symbols, stats: { components: components.length, labeledPins, nets: nets.size } };
}

/** 网络名规范化：GND 家族统一为 GND，电源轨保留原名（去空格、大写）。 */
export function normalizeNet(n: string): string {
  const t = n.trim().replace(/\s+/g, '');
  if (POWER_RE.test(t)) return 'GND';
  if (RAIL_RE.test(t)) return t.toUpperCase().replace(/^3V3$/, '+3V3').replace(/^5V$/, '+5V');
  return t;
}
