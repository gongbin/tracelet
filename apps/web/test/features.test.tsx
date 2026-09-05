import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { createDemoProject, createFromTemplate, paperSize } from '@tracelet/kernel';
import { importProjectFiles } from '../src/store/backup';
import { App } from '../src/App';
import { useApp } from '../src/store/app';
import { usePrefs } from '../src/i18n/index';

(SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
(Element.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
(Element.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => {};

const open = async () => { render(<App />); await screen.findByText('ESP32 传感器板'); act(() => useApp.getState().openProjectObject(createDemoProject())); await screen.findByText('同步到 PCB'); };

describe('新功能冒烟', () => {
  beforeEach(() => { cleanup(); localStorage.clear(); usePrefs.getState().setLocale('zh-CN'); act(() => { if (useApp.getState().editor) useApp.getState().closeProject(); }); });

  it('元件库：标签页、收藏、参数化封装加入项目库', async () => {
    await open();
    act(() => useApp.getState().set('rightTab', 'lib'));
    expect(await screen.findByText('官方库')).toBeTruthy();
    // 收藏第一条
    const star = screen.getAllByTitle('收藏')[0];
    act(() => { fireEvent.click(star); });
    expect(useApp.getState().favorites.length).toBe(1);
    act(() => { fireEvent.click(screen.getByText(/^收藏/, { selector: '.lib-tabs span' })); });
    expect(screen.getAllByTitle('收藏').length).toBe(1);
    // 参数化封装
    act(() => { fireEvent.click(screen.getByText('⚙ 参数化封装')); });
    expect(await screen.findByText('参数化生成封装')).toBeTruthy();
    act(() => { fireEvent.click(screen.getByText('加入项目库')); });
    const ed = useApp.getState().editor!;
    expect(ed.project.library.footprints.some((f) => f.id === 'fp:gen:R_0603_1608Metric')).toBe(true);
    act(() => { ed.undo(); });
    expect(ed.project.library.footprints.some((f) => f.id === 'fp:gen:R_0603_1608Metric')).toBe(false);
  });

  it('图纸：自定义尺寸与标题栏文字', async () => {
    await open();
    const ed = useApp.getState().editor!;
    const select = screen.getByTitle('图纸模板') as HTMLSelectElement;
    act(() => { fireEvent.change(select, { target: { value: 'custom' } }); });
    expect(ed.project.schematic.sheets[0].frame.size).toBe('custom');
    act(() => { fireEvent.click(screen.getByText('标题栏…')); });
    expect(await screen.findByText('图纸边框与标题栏')).toBeTruthy();
    const author = screen.getByPlaceholderText('默认：Tracelet').parentElement!.querySelectorAll('input');
    expect(author.length).toBeGreaterThan(0);
    const title = screen.getByPlaceholderText('默认：项目名') as HTMLInputElement;
    act(() => { fireEvent.change(title, { target: { value: '我的板子' } }); fireEvent.blur(title); });
    expect(ed.project.schematic.sheets[0].frame.title).toBe('我的板子');
    expect(paperSize(ed.project.schematic.sheets[0].frame)).toBeTruthy();
  });

  it('PCB：状态栏栅格 / 线宽选择、仅板级封装放置、层叠对话框', async () => {
    await open();
    act(() => useApp.getState().go('pcb'));
    const grid = screen.getByLabelText('捕捉栅格 (mm)') as HTMLSelectElement;
    act(() => { fireEvent.change(grid, { target: { value: '0.1' } }); });
    expect(useApp.getState().pcbGrid).toBe(0.1);
    const width = screen.getByLabelText(/新走线宽度/) as HTMLSelectElement;
    act(() => { fireEvent.change(width, { target: { value: '0.5' } }); });
    expect(useApp.getState().traceWidthOverride).toBe(0.5);
    // 板级封装放置：库面板 → 放到板上
    act(() => { useApp.getState().set('rightTab', 'lib'); useApp.getState().set('libQuery', 'MountingHole'); });
    const btn = await screen.findAllByText('放到板上');
    act(() => { fireEvent.click(btn[0]); });
    expect(useApp.getState().pcbPlacing?.footprintId).toContain('MountingHole');
    expect(useApp.getState().pcbTool).toBe('place');
    act(() => { fireEvent.keyDown(window, { key: 'r' }); });
    expect(useApp.getState().pcbPlacing?.rotation).toBe(90);
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(useApp.getState().pcbPlacing).toBeNull();
    // 层叠
    act(() => useApp.getState().set('rightTab', 'layers'));
    act(() => { fireEvent.click(screen.getByText('层叠 →')); });
    expect(await screen.findByText('层叠与工艺')).toBeTruthy();
    act(() => { fireEvent.click(screen.getByText('沉金 ENIG', { selector: 'option' }).parentElement!.querySelector('option[value="ENIG"]')!); });
    const sel = screen.getByDisplayValue('有铅喷锡 HASL') as HTMLSelectElement;
    act(() => { fireEvent.change(sel, { target: { value: 'ENIG' } }); });
    expect(useApp.getState().editor!.project.board.stackup?.finish).toBe('ENIG');
  });

  it('向导：按模板创建 STM32 项目', async () => {
    render(<App />);
    await screen.findByText('ESP32 传感器板');
    act(() => useApp.getState().set('wizardOpen', true));
    act(() => { fireEvent.click(screen.getByText('STM32F103 最小系统', { selector: '.chip' })); });
    act(() => { fireEvent.click(screen.getByText('创建并打开原理图 →')); });
    expect(await screen.findByText('同步到 PCB')).toBeTruthy();
    const p = useApp.getState().editor!.project;
    expect(p.name).toBe('STM32F103 最小系统');
    expect(p.board.footprints.some((f) => f.footprintId === 'fp:gen:LQFP-48_7x7mm_P0.5mm')).toBe(true);
    expect(createFromTemplate('arduino').board.footprints.length).toBe(8);
  });

  it('导入嘉立创 EDA 标准版 JSON（原理图 + PCB）', async () => {
    render(<App />);
    await screen.findByText('ESP32 传感器板');
    const pin = (x: number, y: number, n: string, dy: number) => `P~show~0~1~${x}~${y}~0~g${n}~0^^${x}~${y}^^M ${x} ${y} v ${dy}~#880000^^0~${x + 3}~${y}~0~${n}~start~~~#0000FF^^1~${x - 2}~${y}~0~${n}~end~~~#0000FF^^0~${x}~${y}^^0~M ${x} ${y}`;
    const sch = { head: { docType: '1', c_para: { title: '立创测试' } }, canvas: 'CA~1000~1000~#FFFFFF~yes~#CCCCCC~5~1000~1000~line~5~pixel~5~0~0', shape: [`LIB~400~300~package\`R0603\`spicePre\`R\`~0~~gge1~0#@$T~P~410~290~0~#000080~~7pt~~~~~R1~1~start~a~0#@$R~395~300~2~2~10~30~#A00000~1~0~none~c~0#@$${pin(400, 290, '1', 10)}#@$${pin(400, 340, '2', -10)}`, 'W~400 290 400 270~#008800~1~0~none~w~0', 'N~400~270~0~#0000FF~VIN~n~400~270~1~start'] };
    const pcb = { head: { docType: '3' }, canvas: 'CA~1000~1000~#000000~yes~#FFFFFF~10~1000~1000~line~1~mil~1~45~45~4000~3000~0~yes', shape: ['LIB~4100~3050~package`R0603`~0~~l~0#@$PAD~RECT~4096.75~3050~3.54~3.74~1~VIN~1~0~~0~p1~0~~Y~0~0~0.2~#@$PAD~RECT~4103.25~3050~3.54~3.74~1~~2~0~~0~p2~0~~Y~0~0~0.2~#@$TEXT~P~4100~3040~0.8~0~~3~~4.5~R1~~~t~~0', 'TRACK~1~10~~4000 3000 4200 3000 4200 3150 4000 3150 4000 3000~e~0'] };
    await act(async () => { await importProjectFiles([new File([JSON.stringify(sch)], 'Schematic_test.json', { type: 'application/json' }), new File([JSON.stringify(pcb)], 'PCB_test.json', { type: 'application/json' })]); });
    expect(await screen.findByText('同步到 PCB')).toBeTruthy();
    const p = useApp.getState().editor!.project;
    expect(p.schematic.sheets[0].name).toBe('立创测试');
    expect(p.schematic.sheets[0].components.map((c) => c.ref)).toEqual(['R1']);
    expect(p.board.footprints[0]).toMatchObject({ ref: 'R1', padNets: { '1': 'VIN', '2': '' } });
    expect(p.board.footprints[0].componentId).toBe(p.schematic.sheets[0].components[0].id);
  });
});

describe('本地 Agent 桥', () => {
  it('apply 以可撤销命令应用到当前项目，open 打开新项目，undo 撤销', async () => {
    const { handle } = await import('../src/store/bridge');
    const { serializeProject, createFromTemplate } = await import('@tracelet/kernel');
    cleanup(); act(() => { if (useApp.getState().editor) useApp.getState().closeProject(); });
    render(<App />); await screen.findByText('ESP32 传感器板');
    act(() => useApp.getState().openProjectObject(createDemoProject()));
    const ed = useApp.getState().editor!;
    const before = ed.project.schematic.sheets[0].components.length;
    const modified = { ...ed.project, name: 'Agent 改过' };
    act(() => handle({ type: 'apply', id: ed.project.id, rev: 5, doc: serializeProject(modified, false) }));
    expect(useApp.getState().editor!.project.name).toBe('Agent 改过');
    expect(useApp.getState().editor!.undoLabel).toBe('Agent 修改');
    act(() => handle({ type: 'apply', id: 'someone-else', rev: 1, doc: serializeProject(modified, false) }));
    expect(useApp.getState().editor!.project.schematic.sheets[0].components.length).toBe(before);
    act(() => handle({ type: 'undo', id: ed.project.id }));
    expect(useApp.getState().editor!.project.name).toBe('ESP32 传感器板');
    act(() => handle({ type: 'open', doc: serializeProject(createFromTemplate('arduino'), false) }));
    expect(useApp.getState().editor!.project.name).toBe('Arduino 扩展板');
  });
});
