/**
 * 暴露给模型的工具：读工具直接返回内核数据；写工具调用内核命令，全部可 Undo。
 * 与 CLI / MCP 共用同一套内核命令，这里只是 JSON Schema 描述 + 执行映射。
 */
import type Anthropic from '@anthropic-ai/sdk';
import { sch, pcb, lib, searchParts, BUILTIN_PARTS, autoroute, getSymbol, findPin, generateSchematic, registeredSymbols, registeredFootprints, footprintFromName, type Project, type ProjectEditor, type ExtractedSchematic } from '@tracelet/kernel';
import { getAnalysis } from '../store/analysis.js';
import { useApp } from '../store/app.js';
import { locateItem } from '../panels/CheckPanel.js';
import { applySuggestion } from '../panels/AiPanelActions.js';

export interface ToolContext { editor: ProjectEditor; log: (s: string) => void }

const T = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): Anthropic.Tool => ({ name, description, input_schema: { type: 'object', properties, required } });

export const TOOL_DEFS: Anthropic.Tool[] = [
  T('get_project_summary', '项目概览：图纸、元件、网络、PCB 统计、ERC/DRC 计数。回答任何问题前先调用。', {}),
  T('get_netlist', '完整网表：每个网络及其引脚（ref.pin）。', {}),
  T('get_component', '某个元件的详情：值、封装、引脚及其网络。', { ref: { type: 'string', description: '位号，如 U1' } }, ['ref']),
  T('run_erc', '运行电气规则检查，返回问题列表。', {}),
  T('run_drc', '运行 PCB 设计规则检查，返回问题列表与飞线数。', {}),
  T('review_schematic', '确定性经验审查：缺少去耦电容、上拉、LED 限流等，返回建议（含可应用 id）。', {}),
  T('apply_suggestion', '应用 review_schematic 返回的某条建议（放置去耦电容 / 上拉电阻并连线）。', { id: { type: 'string' } }, ['id']),
  T('search_parts', '在元件库搜索零件。', { query: { type: 'string' }, category: { type: 'string', description: '可选分类 id，如 resistor' } }, ['query']),
  T('place_component', '在当前图纸放置元件。symbol 可用内置 id（sym:R sym:C sym:LED sym:GND sym:PWR sym:ESP32-WROOM-32E …）或 search_parts 返回的 partId。', { symbol: { type: 'string' }, value: { type: 'string' }, x: { type: 'number', description: 'mil，可选' }, y: { type: 'number', description: 'mil，可选' } }, ['symbol']),
  T('connect_pins', '用导线连接两个引脚。', { a: { type: 'string', description: 'ref.pin，如 U1.5' }, b: { type: 'string', description: 'ref.pin' } }, ['a', 'b']),
  T('add_net_label', '给某个引脚加网络标签（跨页 / 远距离连接用）。', { pin: { type: 'string', description: 'ref.pin' }, net: { type: 'string' } }, ['pin', 'net']),
  T('set_component_value', '修改元件的值。', { ref: { type: 'string' }, value: { type: 'string' } }, ['ref', 'value']),
  T('move_footprint', '移动 PCB 上的封装到指定坐标（mm）。', { ref: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }, ['ref', 'x', 'y']),
  T('autoroute', '对未布线连接运行内置自动布线并直接应用（可 Undo）。', { nets: { type: 'array', items: { type: 'string' }, description: '可选，只布这些网络' } }),
  T('locate', '在界面里高亮并定位某个 ERC/DRC 问题（id 来自 run_erc / run_drc）。', { id: { type: 'string' } }, ['id']),
  T('generate_sheet_from_spec', '把你从用户附件（原理图 PDF / 图片）或描述中抽取出的电路，生成为一张新的原理图图纸（自动生成符号、放置元件、按网络名连线）。用户上传原理图让你"识别 / 导入 / 画出来"时用这个。位号必须唯一；电源网络写 3V3 / 5V / VBUS，地写 GND；没有连接的引脚 net 写空串。当前图纸为空时会直接替换它。',
    { title: { type: 'string', description: '图纸名 / 电路名' }, components: { type: 'array', items: { type: 'object', properties: { ref: { type: 'string' }, value: { type: 'string' }, kind: { type: 'string', description: 'resistor / capacitor / inductor / diode / led / transistor / ic / module / connector / crystal / switch …' }, footprint: { type: 'string', description: '封装提示，如 0402、SOT-23、LQFP-48，未知写空串' }, pins: { type: 'array', items: { type: 'object', properties: { number: { type: 'string' }, name: { type: 'string' }, net: { type: 'string' } }, required: ['number', 'net'] } } }, required: ['ref', 'pins'] } }, notes: { type: 'array', items: { type: 'string' }, description: '不确定项' } }, ['components']),
  T('delete_components', '删除当前图纸上的元件（连同其连线端点），可 Undo。', { refs: { type: 'array', items: { type: 'string' } } }, ['refs']),
  T('move_component', '移动原理图元件到指定位置（mil，100 的倍数）。', { ref: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' } }, ['ref', 'x', 'y']),
  T('rotate_component', '旋转原理图元件（每次 90°，可指定 times）。', { ref: { type: 'string' }, times: { type: 'number', description: '默认 1' } }, ['ref']),
  T('set_component_footprint', '修改元件封装。可给 KiCad 风格名（如 R_0603_1608Metric、SOT-23、LQFP-48_7x7mm_P0.5mm）自动生成，或库里已有的封装 id。', { ref: { type: 'string' }, footprint: { type: 'string' } }, ['ref', 'footprint']),
  T('set_component_ref', '修改元件位号。', { ref: { type: 'string' }, newRef: { type: 'string' } }, ['ref', 'newRef']),
  T('search_symbols', '搜索已注册的符号（内置 + 本项目导入 / 生成的），用于 place_component 的 symbol 参数。', { query: { type: 'string' } }, ['query']),
  T('list_sheets', '列出所有图纸及元件数，并告知当前图纸。', {}),
  T('switch_sheet', '切换当前图纸（按名字或 id）。', { sheet: { type: 'string' } }, ['sheet']),
  T('add_sheet', '新建一张空图纸并切换过去。', { name: { type: 'string' } }, ['name'])
];

function summary(p: Project) {
  const a = getAnalysis(p);
  return {
    name: p.name, sheets: p.schematic.sheets.map((s) => ({ id: s.id, name: s.name, components: s.components.filter((c) => !getSymbol(c.symbolId).power).length })),
    components: p.schematic.sheets.flatMap((s) => s.components).filter((c) => !getSymbol(c.symbolId).power).map((c) => `${c.ref} ${c.value}`),
    nets: a.netlist.nets.length, unconnectedPins: a.netlist.unconnectedPins.map((x) => `${x.ref}.${x.pinName}`),
    erc: { errors: a.erc.errors, warnings: a.erc.warnings }, drc: { errors: a.drc.errors, warnings: a.drc.warnings },
    pcb: { footprints: p.board.footprints.length, traces: p.board.traces.length, vias: p.board.vias.length, unrouted: `${a.ratsnest.unrouted}/${a.ratsnest.total}`, copperCount: p.board.copperCount, size: `${p.board.outline.reduce((m, q) => Math.max(m, q.x), 0)}×${p.board.outline.reduce((m, q) => Math.max(m, q.y), 0)} mm` },
    rules: a.rules.name
  };
}

const findComp = (p: Project, ref: string) => { for (const s of p.schematic.sheets) { const c = s.components.find((x) => x.ref.toLowerCase() === ref.toLowerCase()); if (c) return { c, sheet: s }; } return null; };
const parsePin = (s: string) => { const m = /^([^.]+)\.(.+)$/.exec(s.trim()); return m ? { ref: m[1], pin: m[2] } : null; };

export async function runTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const { editor } = ctx;
  const p = () => editor.project;
  const app = useApp.getState();
  const sheetId = app.sheetId ?? p().schematic.sheets[0].id;
  const J = (v: unknown) => JSON.stringify(v);
  switch (name) {
    case 'get_project_summary': ctx.log('读取项目概览'); return J(summary(p()));
    case 'get_netlist': { ctx.log('读取网表'); const a = getAnalysis(p()); return J(a.netlist.nets.map((n) => ({ name: n.name, pins: n.pins.map((x) => `${x.ref}.${x.pinNumber}(${x.pinName})`) }))); }
    case 'get_component': {
      const f = findComp(p(), String(input.ref)); if (!f) return `没有位号 ${input.ref}`;
      const a = getAnalysis(p()); const sym = getSymbol(f.c.symbolId);
      ctx.log(`读取 ${f.c.ref}`);
      return J({ ref: f.c.ref, value: f.c.value, symbol: sym.name, footprint: f.c.footprint, sheet: f.sheet.name, pins: sym.pins.map((pin) => ({ number: pin.number, name: pin.name, type: pin.type, net: a.netlist.pinNet.get(`${f.c.id}:${pin.number}`) ?? '' })) });
    }
    case 'run_erc': { ctx.log('运行 ERC'); const a = getAnalysis(p()); return J({ errors: a.erc.errors, warnings: a.erc.warnings, items: a.erc.items.map((i) => ({ id: i.id, severity: i.severity, rule: i.rule, message: i.message, refs: i.refs, why: i.why })) }); }
    case 'run_drc': { ctx.log('运行 DRC'); const a = getAnalysis(p()); return J({ errors: a.drc.errors, warnings: a.drc.warnings, unrouted: a.ratsnest.unrouted, items: a.drc.items.map((i) => ({ id: i.id, severity: i.severity, rule: i.rule, message: i.message, refs: i.refs, why: i.why })) }); }
    case 'review_schematic': { ctx.log('经验规则审查'); const a = getAnalysis(p()); return J(a.review.map((r) => ({ id: r.id, severity: r.severity, title: r.title, detail: r.detail, applicable: !!r.action }))); }
    case 'apply_suggestion': {
      const a = getAnalysis(p()); const s = a.review.find((r) => r.id === input.id); if (!s) return '建议不存在或已失效';
      const ok = applySuggestion(editor, s); ctx.log(ok ? `应用建议：${s.title}` : '建议无法自动应用');
      return ok ? `已应用：${s.title}` : '这条建议没有自动操作';
    }
    case 'search_parts': { ctx.log(`搜索元件 ${input.query}`); return J(searchParts(String(input.query ?? ''), BUILTIN_PARTS, input.category ? String(input.category) : undefined).slice(0, 8).map((x) => ({ partId: x.id, mpn: x.mpn, maker: x.maker, description: x.description, symbol: x.symbolId, footprint: x.footprintId, price: x.price }))); }
    case 'place_component': {
      const key = String(input.symbol); const part = BUILTIN_PARTS.find((x) => x.id === key || x.mpn === key);
      const symbolId = part?.symbolId ?? key;
      try { getSymbol(symbolId); } catch { return `未知符号 ${key}`; }
      const cur = p().schematic.sheets.find((s) => s.id === sheetId)!;
      const maxX = Math.max(1000, ...cur.components.map((c) => c.x));
      const center = { x: typeof input.x === 'number' ? input.x : maxX + 2000, y: typeof input.y === 'number' ? input.y : 2000 };
      const r = sch.placeComponent(p(), { sheetId, symbolId, center, value: input.value ? String(input.value) : part?.value, footprint: part?.footprintId, props: part ? { mpn: part.mpn, lcsc: part.lcsc ?? '' } : undefined });
      editor.dispatch(r.command); ctx.log(`放置 ${r.ref}`);
      useApp.getState().patch({ selection: [r.id] });
      return `已放置 ${r.ref}（id ${r.id}）`;
    }
    case 'connect_pins': {
      const a = parsePin(String(input.a)), b = parsePin(String(input.b)); if (!a || !b) return '引脚格式应为 ref.pin';
      const fa = findComp(p(), a.ref), fb = findComp(p(), b.ref); if (!fa || !fb) return '位号不存在';
      if (fa.sheet.id !== fb.sheet.id) return '两个元件不在同一页，请用 add_net_label';
      const pa = findPin(fa.c, a.pin) ?? getSymbol(fa.c.symbolId).pins.find((x) => x.name === a.pin), pb = findPin(fb.c, b.pin) ?? getSymbol(fb.c.symbolId).pins.find((x) => x.name === b.pin);
      const na = pa && 'def' in pa ? pa.def.number : (pa as { number: string } | undefined)?.number, nb = pb && 'def' in pb ? pb.def.number : (pb as { number: string } | undefined)?.number;
      if (!na || !nb) return '引脚不存在';
      editor.dispatch(sch.connectPins(fa.sheet.id, { componentId: fa.c.id, pin: na }, { componentId: fb.c.id, pin: nb })); ctx.log(`连线 ${input.a} ↔ ${input.b}`);
      return '已连线';
    }
    case 'add_net_label': {
      const pin = parsePin(String(input.pin)); if (!pin) return '引脚格式应为 ref.pin';
      const f = findComp(p(), pin.ref); if (!f) return '位号不存在';
      const g = findPin(f.c, pin.pin) ?? (() => { const d = getSymbol(f.c.symbolId).pins.find((x) => x.name === pin.pin); return d ? findPin(f.c, d.number) : undefined; })();
      if (!g) return '引脚不存在';
      const dir = { x: Math.sign(g.end.x - g.base.x), y: Math.sign(g.end.y - g.base.y) };
      const tip = { x: g.end.x + dir.x * 200, y: g.end.y + dir.y * 200 };
      editor.begin('网络标签'); editor.dispatch(sch.addWire(f.sheet.id, [g.end, tip])); editor.dispatch(sch.addLabel(f.sheet.id, String(input.net), tip)); editor.commit();
      ctx.log(`标签 ${input.net} → ${input.pin}`);
      return '已添加标签';
    }
    case 'set_component_value': { const f = findComp(p(), String(input.ref)); if (!f) return '位号不存在'; editor.dispatch(sch.setComponentValue(f.sheet.id, f.c.id, String(input.value))); ctx.log(`${f.c.ref} 值 → ${input.value}`); return '已修改'; }
    case 'move_footprint': { const fp = p().board.footprints.find((x) => x.ref.toLowerCase() === String(input.ref).toLowerCase()); if (!fp) return 'PCB 上没有该封装（先同步到 PCB）'; editor.dispatch(pcb.moveFootprint(fp.id, { x: Number(input.x), y: Number(input.y) })); ctx.log(`移动 ${fp.ref}`); return '已移动'; }
    case 'autoroute': {
      const a = getAnalysis(p()); const r = autoroute(p().board, a.rules, { nets: Array.isArray(input.nets) ? (input.nets as string[]) : undefined });
      if (r.traces.length) editor.dispatch(pcb.applyRoutes(r.traces, r.vias));
      ctx.log(`自动布线 ${r.routed}/${r.total}`);
      return J({ routed: r.routed, total: r.total, failed: r.failed, traces: r.traces.length, vias: r.vias.length });
    }
    case 'locate': { const a = getAnalysis(p()); const item = [...a.erc.items, ...a.drc.items].find((i) => i.id === input.id); if (!item) return '没有这个问题 id'; locateItem(item, a.drc.items.includes(item) ? 'pcb' : 'sch'); ctx.log(`定位 ${item.message}`); return '已定位'; }
    case 'generate_sheet_from_spec': {
      const spec = input as unknown as ExtractedSchematic;
      if (!Array.isArray(spec.components) || !spec.components.length) return '没有元件，无法生成';
      const r = generateSchematic(spec, { sheetName: (spec.title || '识别的原理图').slice(0, 24) });
      const cur = p().schematic.sheets.find((sh) => sh.id === sheetId);
      const replaceEmpty = !!cur && cur.components.length === 0 && cur.wires.length === 0;
      editor.begin(`生成图纸 ${r.sheet.name}`);
      editor.dispatch(sch.addGeneratedSheet(r.sheet, r.symbols));
      if (replaceEmpty && p().schematic.sheets.length > 1) editor.dispatch(sch.deleteSheet(cur!.id));
      editor.commit();
      useApp.getState().patch({ sheetId: r.sheet.id, selection: [] });
      if (useApp.getState().screen !== 'sch') useApp.getState().go('sch');
      ctx.log(`生成图纸「${r.sheet.name}」：${r.stats.components} 元件 · ${r.stats.nets} 网络`);
      return J({ sheet: r.sheet.name, components: r.stats.components, labeledPins: r.stats.labeledPins, nets: r.stats.nets, replacedEmptySheet: replaceEmpty, hint: '已切换到新图纸；可继续用 run_erc / review_schematic 检查，再用 place_component / connect_pins / set_component_value 修改' });
    }
    case 'delete_components': {
      const refs = Array.isArray(input.refs) ? (input.refs as string[]) : [];
      const bySheet = new Map<string, string[]>(); const missing: string[] = [];
      for (const ref of refs) { const f = findComp(p(), ref); if (!f) { missing.push(ref); continue; } if (!bySheet.has(f.sheet.id)) bySheet.set(f.sheet.id, []); bySheet.get(f.sheet.id)!.push(f.c.id); }
      if (!bySheet.size) return `位号不存在：${missing.join(', ')}`;
      editor.begin(`删除 ${refs.length} 个元件`);
      for (const [sid, ids] of bySheet) editor.dispatch(sch.deleteComponents(sid, ids));
      editor.commit(); ctx.log(`删除 ${refs.join(', ')}`);
      return `已删除 ${refs.length - missing.length} 个${missing.length ? `；不存在：${missing.join(', ')}` : ''}`;
    }
    case 'move_component': { const f = findComp(p(), String(input.ref)); if (!f) return '位号不存在'; const x = Math.round(Number(input.x) / 100) * 100, y = Math.round(Number(input.y) / 100) * 100; editor.dispatch(sch.moveComponent(f.sheet.id, f.c.id, { x, y })); ctx.log(`移动 ${f.c.ref} → (${x}, ${y})`); return '已移动'; }
    case 'rotate_component': { const f = findComp(p(), String(input.ref)); if (!f) return '位号不存在'; const n = Math.max(1, Math.min(3, Math.round(Number(input.times ?? 1)))); editor.begin(`旋转 ${f.c.ref}`); for (let i = 0; i < n; i++) editor.dispatch(sch.rotateComponent(f.sheet.id, f.c.id)); editor.commit(); ctx.log(`旋转 ${f.c.ref} ${n * 90}°`); return '已旋转'; }
    case 'set_component_footprint': {
      const f = findComp(p(), String(input.ref)); if (!f) return '位号不存在';
      const want = String(input.footprint ?? '').trim(); if (!want) return '封装不能为空';
      let id = registeredFootprints().find((d) => d.id === want || d.name === want || d.name.toLowerCase() === want.toLowerCase())?.id;
      if (!id) { const def = footprintFromName(want); if (def) { if (!registeredFootprints().some((d) => d.id === def.id)) editor.dispatch(lib.addLibraryItems({ footprints: [def] })); id = def.id; } }
      if (!id) return `无法识别封装「${want}」：请用 KiCad 风格名（如 R_0603_1608Metric、SOT-23、SOIC-8_3.9x4.9mm_P1.27mm）或库里的封装 id`;
      editor.dispatch(sch.setComponentFootprint(f.sheet.id, f.c.id, id)); ctx.log(`${f.c.ref} 封装 → ${id}`); return `已设置封装 ${id}`;
    }
    case 'set_component_ref': { const f = findComp(p(), String(input.ref)); if (!f) return '位号不存在'; const nr = String(input.newRef ?? '').trim(); if (!nr) return '新位号不能为空'; if (findComp(p(), nr)) return `位号 ${nr} 已被占用`; editor.dispatch(sch.setComponentRef(f.sheet.id, f.c.id, nr)); ctx.log(`${f.c.ref} → ${nr}`); return '已改名'; }
    case 'search_symbols': { const q = String(input.query ?? '').toLowerCase(); ctx.log(`搜索符号 ${q}`); return J(registeredSymbols().filter((sy) => !q || sy.id.toLowerCase().includes(q) || sy.name.toLowerCase().includes(q) || (sy.description ?? '').toLowerCase().includes(q)).slice(0, 12).map((sy) => ({ id: sy.id, name: sy.name, pins: sy.pins.length, power: sy.power, description: sy.description }))); }
    case 'list_sheets': return J({ current: sheetId, sheets: p().schematic.sheets.map((sh) => ({ id: sh.id, name: sh.name, components: sh.components.filter((c) => !getSymbol(c.symbolId).power).length, wires: sh.wires.length })) });
    case 'switch_sheet': { const key = String(input.sheet ?? ''); const sh = p().schematic.sheets.find((x) => x.id === key || x.name === key); if (!sh) return '没有这张图纸'; useApp.getState().patch({ sheetId: sh.id, selection: [] }); ctx.log(`切换到图纸 ${sh.name}`); return `当前图纸：${sh.name}`; }
    case 'add_sheet': { const r = sch.addSheet(String(input.name || `图纸 ${p().schematic.sheets.length + 1}`)); editor.dispatch(r.command); useApp.getState().patch({ sheetId: r.id, selection: [] }); ctx.log(`新建图纸 ${input.name}`); return `已新建并切换到图纸 ${r.id}`; }
    default: return `未知工具 ${name}`;
  }
}
