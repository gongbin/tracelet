import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { createDemoProject, createFromTemplate, paperSize } from '@tracelet/kernel';
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
});
