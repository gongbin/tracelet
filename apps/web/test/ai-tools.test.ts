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
    expect(out.components).toBeGreaterThanOrEqual(3); // 含自动生成的电源符号
    const p = editor.project;
    expect(p.schematic.sheets.length).toBe(1); // 原空图纸被替换
    expect(p.schematic.sheets[0].name).toBe('升压');
    const refs = p.schematic.sheets[0].components.filter((c) => !getSymbol(c.symbolId).power).map((c) => c.ref).sort();
    expect(refs).toEqual(['C1', 'L1', 'U1']);
    expect(await runTool('set_component_footprint', { ref: 'L1', footprint: 'L_0805_2012Metric' }, ctx)).toContain('已设置封装');
    expect(editor.project.schematic.sheets[0].components.find((c) => c.ref === 'L1')!.footprint).toBeTruthy();
    expect(await runTool('set_component_ref', { ref: 'C1', newRef: 'C10' }, ctx)).toBe('已改名');
    expect(await runTool('delete_components', { refs: ['C10', 'C99'] }, ctx)).toContain('已删除 1 个');
    expect(editor.project.schematic.sheets[0].components.some((c) => c.ref === 'C10')).toBe(false);
    editor.undo(); // 删除可撤销
    expect(editor.project.schematic.sheets[0].components.some((c) => c.ref === 'C10')).toBe(true);
    const sheets = JSON.parse(await runTool('list_sheets', {}, ctx)); expect(sheets.sheets.length).toBe(1);
    expect(await runTool('add_sheet', { name: '电源' }, ctx)).toContain('已新建');
    expect(editor.project.schematic.sheets.length).toBe(2);
  });
});
