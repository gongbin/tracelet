import type { Sheet, Schematic } from '../model/schematic.js';
import { buildNetlist, buildSchematicNetlist, type Netlist } from './connectivity.js';
import { getSymbol } from '../library/symbols.js';

export interface ReviewSuggestion {
  id: string;
  title: string;
  detail: string;
  severity: 'info' | 'warning';
  refs: string[];
  /** 可执行的建议动作（由壳层决定如何呈现） */
  action?: { kind: 'add-decoupling'; componentId: string; pinNumber: string; net: string } | { kind: 'add-pullup'; componentId: string; pinNumber: string };
}

/**
 * 确定性设计审查：不依赖 LLM 的经验规则。
 * LLM 助手把这些结果作为"事实"再做解释与排序。
 */
export function reviewSchematic(sheetOrSchematic: Sheet | Schematic, netlist?: Netlist): ReviewSuggestion[] {
  const isSch = 'sheets' in sheetOrSchematic;
  const sheet = (isSch ? { components: (sheetOrSchematic as Schematic).sheets.flatMap((s) => s.components) } : sheetOrSchematic) as Sheet;
  netlist = netlist ?? (isSch ? buildSchematicNetlist(sheetOrSchematic as Schematic) : buildNetlist(sheetOrSchematic as Sheet));
  const out: ReviewSuggestion[] = [];
  let n = 0;
  const comps = new Map(sheet.components.map((c) => [c.id, c]));

  for (const net of netlist.nets) {
    const powerIns = net.pins.filter((p) => p.type === 'power_in' && !/gnd|vss/i.test(p.pinName));
    if (powerIns.length === 0) continue;
    const hasCap = net.pins.some((p) => { const c = comps.get(p.componentId); return c && getSymbol(c.symbolId).id === 'sym:C'; });
    if (!hasCap) {
      for (const p of powerIns) {
        out.push({ id: `rv_${++n}`, severity: 'warning', title: `${p.ref} 的 ${p.pinName} 引脚缺少去耦电容`, detail: `电源网络 ${net.name} 上没有电容。建议在 ${p.ref} 引脚 ${p.pinNumber} 附近放一个 100nF 0402 到 GND。`, refs: [`${p.ref}.${p.pinName}`], action: { kind: 'add-decoupling', componentId: p.componentId, pinNumber: p.pinNumber, net: net.name } });
      }
    }
  }

  for (const c of sheet.components) {
    const sym = getSymbol(c.symbolId);
    if (sym.power) continue;
    for (const pin of sym.pins) {
      if (!/^EN$|RESET|NRST/i.test(pin.name)) continue;
      const net = netlist.pinNet.get(`${c.id}:${pin.number}`);
      if (!net) { out.push({ id: `rv_${++n}`, severity: 'warning', title: `${c.ref} 的 ${pin.name} 悬空`, detail: `使能/复位引脚悬空会导致芯片不启动或随机复位。建议通过 10kΩ 上拉到电源。`, refs: [`${c.ref}.${pin.name}`], action: { kind: 'add-pullup', componentId: c.id, pinNumber: pin.number } }); continue; }
      const netObj = netlist.nets.find((x) => x.name === net);
      const hasR = netObj?.pins.some((p) => { const cc = comps.get(p.componentId); return cc && getSymbol(cc.symbolId).id === 'sym:R'; });
      if (!hasR && !netObj?.powerNames.length) out.push({ id: `rv_${++n}`, severity: 'info', title: `${c.ref} 的 ${pin.name} 没有上拉电阻`, detail: `网络 ${net} 上没有电阻。多数模块要求 EN/RESET 通过 10kΩ 上拉。`, refs: [`${c.ref}.${pin.name}`], action: { kind: 'add-pullup', componentId: c.id, pinNumber: pin.number } });
    }
  }

  const leds = sheet.components.filter((c) => c.symbolId === 'sym:LED');
  for (const d of leds) {
    const nets = ['1', '2'].map((pn) => netlist.pinNet.get(`${d.id}:${pn}`)).filter(Boolean) as string[];
    const hasSeriesR = nets.some((nn) => netlist.nets.find((x) => x.name === nn)?.pins.some((p) => comps.get(p.componentId)?.symbolId === 'sym:R'));
    if (nets.length === 2 && !hasSeriesR) out.push({ id: `rv_${++n}`, severity: 'warning', title: `${d.ref} 没有限流电阻`, detail: `LED 两端都已连线但串联路径上没有电阻，直接驱动会烧毁 LED 或 IO 口。`, refs: [d.ref] });
  }
  return out;
}
