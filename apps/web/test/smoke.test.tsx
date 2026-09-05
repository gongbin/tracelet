import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { createDemoProject } from '@tracelet/kernel';
import { App } from '../src/App';
import { useApp } from '../src/store/app';
import { usePrefs } from '../src/i18n/index';

// jsdom 没有 SVG 几何 API
(SVGElement.prototype as unknown as { getBBox: () => DOMRect }).getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
(Element.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
(Element.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture = () => {};

describe('应用冒烟测试', () => {
  it('语言切换：英文界面显示 Projects，切回中文显示 项目', async () => {
    render(<App />);
    await screen.findByText('ESP32 传感器板');
    act(() => usePrefs.getState().setLocale('en'));
    expect(await screen.findByText('Projects')).toBeTruthy();
    act(() => usePrefs.getState().setLocale('zh-CN'));
    expect(await screen.findByText('项目')).toBeTruthy();
  });
  it('主题切换写入 data-theme', () => {
    act(() => usePrefs.getState().setTheme('light'));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    act(() => usePrefs.getState().setTheme('system'));
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    act(() => usePrefs.getState().setTheme('dark'));
  });
  beforeEach(() => { cleanup(); localStorage.clear(); usePrefs.getState().setLocale('zh-CN'); act(() => { if (useApp.getState().editor) useApp.getState().closeProject(); }); });

  it('首页渲染并显示示例项目', async () => {
    render(<App />);
    expect(await screen.findByText('ESP32 传感器板')).toBeTruthy();
    expect(screen.getByText('新建项目')).toBeTruthy();
  });

  it('打开项目后原理图 / PCB / 3D / 制造 / 库 / BOM 六个页面都能渲染', async () => {
    render(<App />);
    await screen.findByText('ESP32 传感器板');
    act(() => useApp.getState().openProjectObject(createDemoProject()));
    expect(await screen.findByText('同步到 PCB')).toBeTruthy();
    for (const s of ['pcb', '3d', 'fab', 'lib', 'bom', 'sch'] as const) {
      act(() => useApp.getState().go(s));
    }
    expect(screen.getAllByText(/主图/).length).toBeGreaterThan(0);
  });

  it('右侧五个面板都能渲染，且 PCB 检查面板显示未布线错误', async () => {
    render(<App />);
    await screen.findByText('ESP32 传感器板');
    act(() => useApp.getState().openProjectObject(createDemoProject()));
    for (const t of ['props', 'lib', 'check', 'ai'] as const) act(() => useApp.getState().set('rightTab', t));
    act(() => { useApp.getState().go('pcb'); useApp.getState().set('rightTab', 'check'); });
    expect(await screen.findByText(/未连接网络 GND/)).toBeTruthy();
    act(() => useApp.getState().set('rightTab', 'layers'));
    expect(screen.getAllByText('F.Cu').length).toBeGreaterThan(0);
  });

  it('快捷键：R 进入放电阻，Esc 退出；⌘Z 撤销', async () => {
    render(<App />);
    await screen.findByText('ESP32 传感器板');
    act(() => useApp.getState().openProjectObject(createDemoProject()));
    await screen.findByText('同步到 PCB');
    act(() => { fireEvent.keyDown(window, { key: 'r' }); });
    expect(useApp.getState().placing?.symbolId).toBe('sym:R');
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(useApp.getState().placing).toBeNull();
    const ed = useApp.getState().editor!;
    const before = ed.project.schematic.sheets[0].components.length;
    act(() => { fireEvent.keyDown(window, { key: 'Delete' }); });
    act(() => useApp.getState().patch({ selection: [ed.project.schematic.sheets[0].components[1].id] }));
    act(() => { fireEvent.keyDown(window, { key: 'Delete' }); });
    expect(ed.project.schematic.sheets[0].components.length).toBe(before - 1);
    act(() => { fireEvent.keyDown(window, { key: 'z', metaKey: true }); });
    expect(ed.project.schematic.sheets[0].components.length).toBe(before);
  });

  it('自动布线：进入 running → done，接受后飞线清零', async () => {
    render(<App />);
    await screen.findByText('ESP32 传感器板');
    act(() => useApp.getState().openProjectObject(createDemoProject()));
    act(() => useApp.getState().go('pcb'));
    act(() => useApp.getState().patch({ pcbTool: 'autoroute' }));
    expect(useApp.getState().autoroute.status).toBe('running');
    await new Promise((r) => setTimeout(r, 200));
    expect(useApp.getState().autoroute.status).toBe('done');
    expect(await screen.findByText('接受')).toBeTruthy();
    fireEvent.click(screen.getByText('接受'));
    expect(useApp.getState().autoroute.status).toBe('idle');
    const { computeRatsnest, ruleSetOf } = await import('@tracelet/kernel');
    const ed = useApp.getState().editor!;
    expect(computeRatsnest(ed.project.board, ruleSetOf(ed.project)).unrouted).toBe(0);
    act(() => { fireEvent.keyDown(window, { key: 'z', metaKey: true }); });
    expect(computeRatsnest(ed.project.board, ruleSetOf(ed.project)).unrouted).toBeGreaterThan(0);
  });

  it('多页：新建图纸后切换，页码显示 2/2；复制粘贴进入粘贴态，⌘D 复制到位', async () => {
    render(<App />);
    await screen.findByText('ESP32 传感器板');
    act(() => useApp.getState().openProjectObject(createDemoProject()));
    await screen.findByText('同步到 PCB');
    const ed = useApp.getState().editor!;
    const { sch } = await import('@tracelet/kernel');
    const r = sch.addSheet('电源');
    act(() => { ed.dispatch(r.command); useApp.getState().patch({ sheetId: r.id }); });
    expect(await screen.findByText(/页 2\/2/)).toBeTruthy();
    act(() => useApp.getState().patch({ sheetId: ed.project.schematic.sheets[0].id }));
    const before = ed.project.schematic.sheets[0].components.length;
    const r1 = ed.project.schematic.sheets[0].components.find((c) => c.ref === 'R1')!;
    act(() => useApp.getState().patch({ selection: [r1.id] }));
    act(() => { fireEvent.keyDown(window, { key: 'c', metaKey: true }); });
    act(() => { fireEvent.keyDown(window, { key: 'v', metaKey: true }); });
    expect(useApp.getState().pasting?.clip.components.length).toBe(1);
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(useApp.getState().pasting).toBeNull();
    act(() => { fireEvent.keyDown(window, { key: 'd', metaKey: true }); });
    expect(ed.project.schematic.sheets[0].components.length).toBe(before + 1);
    expect(ed.project.schematic.sheets[0].components.some((c) => c.ref === 'R2')).toBe(true);
  });

  it('命令面板打开并列出命令与元件', async () => {
    render(<App />);
    await screen.findByText('ESP32 传感器板');
    act(() => useApp.getState().openProjectObject(createDemoProject()));
    act(() => useApp.getState().set('paletteOpen', true));
    const input = await screen.findByPlaceholderText(/输入命令/);
    fireEvent.change(input, { target: { value: '@esp32' } });
    expect((await screen.findAllByText('ESP32-WROOM-32E')).length).toBeGreaterThan(0);
  });
});
