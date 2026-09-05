import { describe, it, expect } from 'vitest';
import {
  importKicadSymbolLib, importKicadFootprintMod, importLibraryFile, footprintFromName, generateFootprint, validateSpec, PROJECT_TEMPLATES, createFromTemplate,
  exportSchematicPdf, exportAssemblyPdf, paperSize, createProject, createDemoProject, ProjectEditor, pcb, sch, lib, runDrc, runSchematicErc, ruleSetOf, diffBoardFromSchematic,
  serializeProject, parseProject, findFootprint, footprintPads, generateSchematic, componentStrokes, getSymbol, exportFabFiles, computeRatsnest
} from '../src/index.js';

const SYM_LIB = `(kicad_symbol_lib (version 20231120) (generator "kicad_symbol_editor")
  (symbol "MyChip" (in_bom yes) (on_board yes)
    (property "Reference" "U" (at 0 0 0)) (property "Value" "MyChip" (at 0 0 0)) (property "Footprint" "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm" (at 0 0 0)) (property "ki_keywords" "amp" (at 0 0 0))
    (symbol "MyChip_0_1" (rectangle (start -5.08 5.08) (end 5.08 -5.08) (stroke (width 0.254) (type default)) (fill (type background))))
    (symbol "MyChip_1_1"
      (pin input line (at -7.62 2.54 0) (length 2.54) (name "IN" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
      (pin output line (at 7.62 2.54 180) (length 2.54) (name "OUT" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))
      (pin power_in line (at 0 -7.62 90) (length 2.54) (name "GND" (effects (font (size 1.27 1.27)))) (number "3" (effects (font (size 1.27 1.27)))))))
  (symbol "MyChip-B" (extends "MyChip") (property "Value" "MyChip-B" (at 0 0 0)))
  (symbol "Dual" (property "Reference" "U" (at 0 0 0)) (property "Value" "Dual" (at 0 0 0))
    (symbol "Dual_1_1" (pin input line (at -5.08 0 0) (length 2.54) (name "A" (effects (font (size 1 1)))) (number "1" (effects (font (size 1 1))))))
    (symbol "Dual_2_1" (pin input line (at -5.08 0 0) (length 2.54) (name "B" (effects (font (size 1 1)))) (number "2" (effects (font (size 1 1)))))))
)`;
const MOD = `(footprint "TEST-2P" (version 20240108) (generator "pcbnew") (layer "F.Cu") (descr "two pad test")
  (fp_line (start -1 -0.5) (end 1 -0.5) (stroke (width 0.05) (type default)) (layer "F.CrtYd"))
  (fp_line (start -1 0.5) (end 1 0.5) (stroke (width 0.05) (type default)) (layer "F.CrtYd"))
  (pad "1" smd roundrect (at -0.5 0) (size 0.6 0.7) (layers "F.Cu" "F.Paste" "F.Mask"))
  (pad "2" smd roundrect (at 0.5 0) (size 0.6 0.7) (layers "F.Cu" "F.Paste" "F.Mask")))`;

describe('KiCad 库文件导入', () => {
  it('.kicad_sym：多符号、派生符号继承、多单元拆分、默认封装', () => {
    const syms = importKicadSymbolLib(SYM_LIB, 'Test.kicad_sym');
    const ids = syms.map((s) => s.id);
    expect(ids).toContain('sym:kicad:Test:MyChip');
    expect(ids).toContain('sym:kicad:Test:MyChip-B');
    expect(ids).toContain('sym:kicad:Test:Dual#u1'); expect(ids).toContain('sym:kicad:Test:Dual#u2');
    const chip = syms.find((s) => s.id === 'sym:kicad:Test:MyChip')!;
    expect(chip.pins.map((p) => p.number)).toEqual(['1', '2', '3']);
    expect(chip.pins.find((p) => p.number === '3')!.type).toBe('power_in');
    expect(chip.defaultFootprint).toBe('fp:kicad:SOIC-8_3.9x4.9mm_P1.27mm');
    expect(chip.kind).toBe('amp');
    const b = syms.find((s) => s.id === 'sym:kicad:Test:MyChip-B')!;
    expect(b.pins.length).toBe(3); expect(b.defaultValue).toBe('MyChip-B');
    expect(getSymbol('sym:kicad:Test:MyChip').id).toBe('sym:kicad:Test:MyChip');
  });
  it('.kicad_mod：焊盘与本体', () => {
    const fp = importKicadFootprintMod(MOD, 'TEST-2P.kicad_mod');
    expect(fp.id).toBe('fp:kicad:TEST-2P'); expect(fp.pads.length).toBe(2); expect(fp.body).toEqual({ w: 2, h: 1 }); expect(fp.description).toBe('two pad test');
    expect(findFootprint('fp:kicad:TEST-2P')).toBeTruthy();
  });
  it('importLibraryFile 分派与提示', () => {
    expect(importLibraryFile('a.kicad_mod', MOD).footprints.length).toBe(1);
    expect(importLibraryFile('old.lib', '').warnings[0]).toMatch(/kicad_sym/);
    expect(() => importKicadSymbolLib('(kicad_pcb)')).toThrow();
  });
});

describe('参数化封装', () => {
  it('按 KiCad 名称生成常见封装', () => {
    const cases: [string, number][] = [['R_0603_1608Metric', 2], ['C_0402', 2], ['SOIC-8_3.9x4.9mm_P1.27mm', 8], ['TSSOP-20_4.4x6.5mm_P0.65mm', 20], ['LQFP-48_7x7mm_P0.5mm', 48], ['QFN-32-1EP_5x5mm_P0.5mm_EP3.45x3.45mm', 33], ['DIP-8_W7.62mm', 8], ['PinHeader_2x05_P2.54mm_Vertical', 10], ['SOT-23', 3], ['SOT-23-5', 5], ['SOT-23-6', 6]];
    for (const [name, n] of cases) { const fp = footprintFromName(`Lib:${name}`); expect(fp, name).toBeTruthy(); expect(fp!.pads.length, name).toBe(n); }
    expect(footprintFromName('Weird_Thing')).toBeUndefined();
  });
  it('几何合理：焊盘互不重叠、逆时针编号、DIP 通孔', () => {
    const q = footprintFromName('LQFP-48_7x7mm_P0.5mm')!;
    for (let i = 0; i < q.pads.length; i++) for (let j = i + 1; j < q.pads.length; j++) { const a = q.pads[i], b = q.pads[j]; const gap = Math.max(Math.abs(a.x - b.x) - (a.w + b.w) / 2, Math.abs(a.y - b.y) - (a.h + b.h) / 2); expect(gap, `${a.number}-${b.number}`).toBeGreaterThan(0.1); }
    const p1 = q.pads.find((p) => p.number === '1')!, p12 = q.pads.find((p) => p.number === '12')!, p13 = q.pads.find((p) => p.number === '13')!;
    expect(p1.x).toBeLessThan(0); expect(p12.y).toBeGreaterThan(p1.y); expect(p13.y).toBeGreaterThan(0); // 左列自上而下，然后底边
    const d = generateFootprint({ kind: 'dip', pins: 8 });
    expect(d.pads.every((p) => p.drill > 0)).toBe(true); expect(d.pads.find((p) => p.number === '8')!.y).toBeCloseTo(d.pads.find((p) => p.number === '1')!.y);
    expect(validateSpec({ kind: 'qfp', pins: 30 })).toMatch(/4 的倍数/); expect(validateSpec({ kind: 'soic', pins: 8 })).toBeNull();
  });
  it('generateSchematic 识别 KiCad 风格封装名', () => {
    const r = generateSchematic({ components: [{ ref: 'U9', value: 'X', kind: 'mcu', footprint: 'LQFP-48_7x7mm_P0.5mm', pins: Array.from({ length: 48 }, (_, i) => ({ number: String(i + 1), name: `P${i}` })) }] });
    expect(r.sheet.components[0].footprint).toBe('fp:gen:LQFP-48_7x7mm_P0.5mm');
  });
});

describe('项目模板', () => {
  for (const t of PROJECT_TEMPLATES) {
    it(`${t.name}：可生成、无元件重叠、原理图与 PCB 一致、可保存重开`, () => {
      const p = t.create({ name: `T-${t.id}` });
      expect(p.name).toBe(`T-${t.id}`);
      const rules = ruleSetOf(p);
      const drc = runDrc(p.board, rules);
      expect(drc.items.filter((i) => i.rule === 'courtyard-overlap').map((i) => i.refs.join('-')), t.id).toEqual([]);
      expect(drc.items.filter((i) => i.rule === 'outside-board').map((i) => i.refs.join('-')), t.id).toEqual([]);
      const d = diffBoardFromSchematic(p); expect(d.added).toEqual([]); expect(d.removed).toEqual([]);
      const erc = runSchematicErc(p.schematic); expect(erc.errors, JSON.stringify(erc.items.filter((i) => i.severity === 'error'))).toBe(0);
      const again = parseProject(serializeProject(p));
      for (const f of again.board.footprints) expect(findFootprint(f.footprintId), f.footprintId).toBeTruthy();
      if (t.id !== 'blank') expect(computeRatsnest(p.board, rules).total).toBeGreaterThan(0);
    });
  }
  it('Arduino 排母位置：J1 pin1 在 (0.64in, 0.1in)，引脚沿 +x', () => {
    const p = createFromTemplate('arduino');
    const j1 = p.board.footprints.find((f) => f.ref === 'J1')!;
    const pads = footprintPads(j1, p.board);
    const p1 = pads.find((x) => x.number === '1')!, p10 = pads.find((x) => x.number === '10')!;
    expect(p1.center.x).toBeCloseTo(0.8 * 25.4, 2); expect(p1.center.y).toBeCloseTo(2.54, 2);
    expect(p10.center.x).toBeCloseTo(p1.center.x + 9 * 2.54, 2); expect(p10.center.y).toBeCloseTo(p1.center.y, 2);
    expect(p.board.footprints.filter((f) => f.ref.startsWith('H')).length).toBe(4);
  });
  it('STM32：LQFP-48 封装 48 焊盘，电源引脚接到 +3V3 / GND', () => {
    const p = createFromTemplate('stm32');
    const u1 = p.board.footprints.find((f) => f.ref === 'U1')!;
    expect(Object.keys(u1.padNets).length).toBe(48);
    expect(u1.padNets['24']).toBe('+3V3'); expect(u1.padNets['23']).toBe('GND'); expect(u1.padNets['34']).toBe('SWDIO');
  });
});

describe('PDF 导出', () => {
  const valid = (pdf: string) => {
    expect(pdf.startsWith('%PDF-1.4')).toBe(true); expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    // 校验 xref 偏移指向对应对象
    const start = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    const lines = pdf.slice(start).split('\n');
    const n = Number(lines[1].split(' ')[1]);
    for (let i = 1; i < n; i++) { const off = Number(lines[2 + i].slice(0, 10)); expect(pdf.slice(off, off + 20).startsWith(`${i} 0 obj`)).toBe(true); }
    for (const ch of pdf) expect(ch.charCodeAt(0)).toBeLessThan(128);
  };
  it('原理图 PDF：每页一张图纸，结构有效', () => {
    const p = createDemoProject();
    const pdf = exportSchematicPdf(p);
    valid(pdf); expect(pdf).toContain('/Count 1'); expect(pdf).toContain('(U1) Tj');
    const ed = new ProjectEditor(p); ed.dispatch(sch.addSheet('第二页').command);
    expect(exportSchematicPdf(ed.project)).toContain('/Count 2');
  });
  it('装配图 PDF：顶 / 底两页，位号在页面中', () => {
    const pdf = exportAssemblyPdf(createDemoProject());
    valid(pdf); expect(pdf).toContain('/Count 2'); expect(pdf).toContain('(R1) Tj'); expect(pdf).toContain('TOP');
  });
  it('制造包可选装配图 / 原理图 PDF', () => {
    const files = exportFabFiles(createDemoProject(), { assemblyPdf: true, schematicPdf: true });
    expect(files.filter((f) => f.kind === 'pdf').map((f) => f.name.split('-').pop())).toEqual(['Assembly.pdf', 'Schematic.pdf']);
  });
  it('componentStrokes 含引脚与位号', () => {
    const p = createDemoProject(); const c = p.schematic.sheets[0].components.find((x) => x.ref === 'R1')!;
    const s = componentStrokes(c);
    expect(s.lines.length).toBeGreaterThanOrEqual(3); expect(s.texts.some((t) => t.text === 'R1')).toBe(true);
  });
});

describe('图纸尺寸与命令', () => {
  it('paperSize：标准 / 纵向 / 自定义 / 无', () => {
    const f = { size: 'A4', landscape: true, title: '', revision: '', company: '', author: '', date: '', comment: '', labels: { sheet: '', date: '', revision: '', page: '', author: '' } } as const;
    expect(paperSize({ ...f })).toEqual({ w: 11693, h: 8268 });
    expect(paperSize({ ...f, landscape: false })).toEqual({ w: 8268, h: 11693 });
    expect(paperSize({ ...f, size: 'custom', width: 9000, height: 6000 })).toEqual({ w: 9000, h: 6000 });
    expect(paperSize({ ...f, size: 'none' })).toBeNull();
    expect(parseProject(serializeProject(createProject({ name: 'x' }))).schematic.sheets[0].frame.labels.sheet).toBe('图纸');
  });
  it('addBoardFootprint：位号自动递增、同步保留、可删除', () => {
    const ed = new ProjectEditor(createDemoProject());
    const a = pcb.addBoardFootprint(ed.project, { footprintId: 'fp:MountingHole_3.2mm', x: 3, y: 3 }); ed.dispatch(a.command);
    const b = pcb.addBoardFootprint(ed.project, { footprintId: 'fp:MountingHole_3.2mm', x: 47, y: 3 }); ed.dispatch(b.command);
    expect([a.ref, b.ref]).toEqual(['H1', 'H2']);
    ed.dispatch(pcb.syncFromSchematic());
    expect(ed.project.board.footprints.filter((f) => f.ref.startsWith('H')).length).toBe(2);
    ed.dispatch(pcb.deleteFootprints([a.id]));
    expect(ed.project.board.footprints.some((f) => f.id === a.id)).toBe(false);
    ed.undo(); expect(ed.project.board.footprints.some((f) => f.id === a.id)).toBe(true);
  });
  it('setBoardProps / setComponentProps / 项目库命令', () => {
    const ed = new ProjectEditor(createDemoProject());
    ed.dispatch(pcb.setBoardProps({ thickness: 1.0, stackup: { finish: 'ENIG', maskColor: '黑' } }));
    expect(ed.project.board.thickness).toBe(1.0); expect(ed.project.board.stackup?.finish).toBe('ENIG'); expect(ed.project.board.stackup?.copperWeight).toBe(1);
    const sheet = ed.project.schematic.sheets[0]; const c = sheet.components[0];
    ed.dispatch(sch.setComponentProps(sheet.id, c.id, { mpn: 'ABC', tolerance: '1%' }));
    expect(ed.project.schematic.sheets[0].components[0].props).toEqual({ mpn: 'ABC', tolerance: '1%' });
    const fp = footprintFromName('SOIC-8_3.9x4.9mm_P1.27mm')!;
    ed.dispatch(lib.addLibraryItems({ footprints: [fp] }));
    expect(ed.project.library.footprints.some((f) => f.id === fp.id)).toBe(true);
    ed.dispatch(lib.addLibraryItems({ footprints: [fp] })); expect(ed.project.library.footprints.filter((f) => f.id === fp.id).length).toBe(1);
    ed.dispatch(lib.removeLibraryItems([fp.id])); expect(ed.project.library.footprints.some((f) => f.id === fp.id)).toBe(false);
    expect(exportFabFiles(ed.project).find((f) => f.kind === 'readme')!.content).toContain('ENIG');
  });
});

describe('板框尺寸 / 移动 / 适配', () => {
  it('setOutlineRect 保持左上角；translateBoard 连同内容；fitOutlineToContent 包住内容；归零', () => {
    const ed = new ProjectEditor(createDemoProject());
    const original = ed.project.board;
    ed.dispatch(pcb.translateBoard(10, 5));
    const b1 = ed.project.board; const u1 = b1.footprints.find((f) => f.ref === 'U1')!;
    expect(b1.outline[0]).toEqual({ x: 10, y: 5 }); expect(u1.x).toBe(26); expect(b1.traces[0].points[0].x).toBeCloseTo(original.traces[0].points[0].x + 10, 3);
    ed.dispatch(pcb.setOutlineRect(60, 40));
    expect(ed.project.board.outline).toEqual([{ x: 10, y: 5 }, { x: 70, y: 5 }, { x: 70, y: 45 }, { x: 10, y: 45 }]);
    expect(ed.project.board.footprints.find((f) => f.ref === 'U1')!.x).toBe(26);
    ed.dispatch(pcb.translateOutline(-10, -5));
    expect(ed.project.board.outline[0]).toEqual({ x: 0, y: 0 }); expect(ed.project.board.footprints.find((f) => f.ref === 'U1')!.x).toBe(26);
    ed.dispatch(pcb.fitOutlineToContent(2));
    const c = pcb.contentBounds(ed.project.board)!; const o = ed.project.board.outline;
    expect(o[0].x).toBeLessThanOrEqual(c.x - 2 + 0.5); expect(o[2].x).toBeGreaterThanOrEqual(c.x + c.w + 2 - 0.5); expect(o[2].y).toBeGreaterThanOrEqual(c.y + c.h + 2 - 0.5);
    expect(runDrc(ed.project.board, ruleSetOf(ed.project)).items.filter((i) => i.rule === 'outside-board')).toEqual([]);
    ed.dispatch(pcb.normalizeBoardOrigin());
    expect(ed.project.board.outline[0]).toEqual({ x: 0, y: 0 });
    ed.undo(); ed.undo(); ed.undo(); ed.undo(); ed.undo();
    expect(ed.project.board).toEqual(original);
  });
});
