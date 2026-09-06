import { describe, it, expect } from 'vitest';
import { createProject, getSymbol } from '@tracelet/kernel';
import { useApp } from '../src/store/app.js';
import { runTool, TOOL_DEFS } from '../src/ai/tools.js';

describe('AI 工具', () => {
  it('generate_sheet_from_spec 生成图纸并替换空图纸；随后可删除 / 改封装 / 改位号', async () => {
    useApp.getState().openProjectObject(createProject({ name: 'ai' }));
    const editor = useApp.getState().editor!;
    const log: string[] = [];
    const ctx = { editor, log: (s: string) => log.push(s) };
    expect(TOOL_DEFS.some((t) => t.name === 'generate_sheet_from_spec')).toBe(true);
    const spec = { title: '升压', components: [
      { ref: 'U1', value: 'MAX17220', kind: 'ic', footprint: 'SOT-23-6', pins: [{ number: '1', name: 'LX', net: 'SW' }, { number: '2', name: 'GND', net: 'GND' }, { number: '3', name: 'OUT', net: '3V3' }, { number: '4', name: 'IN', net: 'VBAT' }, { number: '5', name: 'EN', net: 'VBAT' }, { number: '6', name: 'SEL', net: '' }] },
      { ref: 'L1', value: '2.2uH', kind: 'inductor', footprint: '', pins: [{ number: '1', name: '1', net: 'VBAT' }, { number: '2', name: '2', net: 'SW' }] },
      { ref: 'C1', value: '10uF', kind: 'capacitor', footprint: '0603', pins: [{ number: '1', name: '1', net: '3V3' }, { number: '2', name: '2', net: 'GND' }] }
    ] };
    const out = JSON.parse(await runTool('generate_sheet_from_spec', spec as unknown as Record<string, unknown>, ctx));
    expect(out.components.length).toBe(3); expect(out.ok).toBe(true); expect(out.emptyNets).toEqual([]);
    const p = editor.project;
    expect(p.schematic.sheets.length).toBe(2); // 只新增，不删原图纸
    expect(p.schematic.sheets[1].name).toBe("升压");
    const gen = () => editor.project.schematic.sheets.find((sh) => sh.name === '升压')!;
    const refs = gen().components.filter((c) => !getSymbol(c.symbolId).power).map((c) => c.ref).sort();
    expect(refs).toEqual(['C1', 'L1', 'U1']);
    expect(await runTool('set_component_footprint', { ref: 'L1', footprint: 'L_0805_2012Metric' }, ctx)).toContain('已设置封装');
    expect(gen().components.find((c) => c.ref === 'L1')!.footprint).toBeTruthy();
    expect(await runTool('set_component_ref', { ref: 'C1', newRef: 'C10' }, ctx)).toBe('已改名');
    expect(await runTool('delete_components', { refs: ['C10', 'C99'] }, ctx)).toContain('已删除 1 个');
    expect(gen().components.some((c) => c.ref === 'C10')).toBe(false);
    editor.undo(); // 删除可撤销
    expect(gen().components.some((c) => c.ref === 'C10')).toBe(true);
    const sheets = JSON.parse(await runTool('list_sheets', {}, ctx)); expect(sheets.sheets.length).toBe(2);
    expect(await runTool('add_sheet', { name: '电源' }, ctx)).toContain('已新建');
    expect(editor.project.schematic.sheets.length).toBe(3);
    expect(await runTool('rename_sheet', { sheet: '电源', name: '电源页' }, ctx)).toBe('已重命名');
    expect(await runTool('delete_sheet', { sheet: '电源页' }, ctx)).toContain('已删除图纸');
    expect(editor.project.schematic.sheets.length).toBe(2);
    expect(await runTool('switch_sheet', { sheet: '升压' }, ctx)).toContain('升压');
    // 悬空导线清理：加一条谁也不连的线，再清理
    const sid = gen().id;
    const { sch } = await import('@tracelet/kernel');
    const before = gen().wires.length;
    editor.dispatch(sch.addWire(sid, [{ x: 9000, y: 9000 }, { x: 9500, y: 9000 }]));
    expect(await runTool('delete_dangling', {}, ctx)).toContain('已删除 1 条悬空导线');
    expect(gen().wires.length).toBe(before);
    // 生成结果自检字段
    const out2 = JSON.parse(await runTool('generate_sheet_from_spec', { title: '空', components: [{ ref: 'X1', pins: [] }] } as unknown as Record<string, unknown>, ctx));
    expect(out2).toBeTypeOf('object');
  });
});
