import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { createDemoProject, emptyBoard, ruleSetOf, runDrc } from '@tracelet/kernel';
import { DiagnosticText } from '../src/i18n/DiagnosticText';
import { usePrefs } from '../src/i18n/index';
import { setAutoTranslate } from '../src/i18n/auto';
import { CheckPanel } from '../src/panels/CheckPanel';
import { BottomBar } from '../src/components/BottomBar';
import { useApp } from '../src/store/app';

afterEach(() => { cleanup(); act(() => usePrefs.getState().setLocale('zh-CN')); });

function projectWithWarning() {
  const project = createDemoProject();
  project.board = emptyBoard();
  project.board.traces.push({ id: 'thin-power', layer: 'F.Cu', width: 0.25, net: 'VCC', points: [{ x: 5, y: 5 }, { x: 10, y: 5 }] });
  return project;
}

describe('PCB diagnostic localization', () => {
  it('renders a real net-class warning in both lists without the DOM translation observer', () => {
    const project = projectWithWarning();
    const warning = runDrc(project.board, ruleSetOf(project)).items.find((i) => i.rule === 'netclass-width')!;
    expect(warning).toBeDefined();
    act(() => {
      usePrefs.getState().setLocale('en');
      setAutoTranslate(false);
      useApp.getState().openProjectObject(project);
      useApp.getState().patch({ screen: 'pcb', bottomExpanded: true, bottomTab: 'problems' });
    });
    render(<><CheckPanel /><BottomBar summary={[]} nets={[]} problems={[{ id: warning.id, mark: '⚠', color: '', text: warning.message, where: warning.refs.join(' · ') }]} /></>);
    expect(screen.getAllByText('Trace narrower than net class Power (0.25 < 0.5mm)')).toHaveLength(2);
    expect(screen.queryByText(warning.message)).toBeNull();
    act(() => usePrefs.getState().setLocale('zh-CN'));
    expect(screen.getAllByText(warning.message)).toHaveLength(2);
    act(() => { usePrefs.getState().setLocale('en'); setAutoTranslate(false); });
    expect(screen.getAllByText('Trace narrower than net class Power (0.25 < 0.5mm)')).toHaveLength(2);
  });

  it('translates changing diagnostics and explanations immediately, retaining measurements', () => {
    act(() => { usePrefs.getState().setLocale('en'); setAutoTranslate(false); });
    const { rerender } = render(<DiagnosticText>走线宽度低于网络类 Power（0.25 &lt; 0.5mm）</DiagnosticText>);
    expect(screen.getByText('Trace narrower than net class Power (0.25 < 0.5mm)')).toBeTruthy();
    rerender(<DiagnosticText>走线宽度低于网络类 Power（0.3 &lt; 0.5mm）</DiagnosticText>);
    expect(screen.getByText('Trace narrower than net class Power (0.3 < 0.5mm)')).toBeTruthy();
    rerender(<DiagnosticText>电源类走线太细会发热、压降变大。</DiagnosticText>);
    expect(screen.getByText('Thin power traces heat up and drop voltage.')).toBeTruthy();
  });
});
