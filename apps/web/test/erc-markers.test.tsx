import { afterEach, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createProject, importKicadSchematic, getSymbol, symbolLocalStrokes, pinGeoms, orderedSymbolShapes, runErc } from '@tracelet/kernel';
import { SymbolGlyph } from '../src/editors/schematic/SymbolGlyph';
import { SchematicCanvas } from '../src/editors/schematic/SchematicCanvas';
import { CheckPanel, locateItem } from '../src/panels/CheckPanel';
import { useApp } from '../src/store/app';
import { getAnalysis } from '../src/store/analysis';
import { usePrefs, LOCALES, translate } from '../src/i18n';
import { translateText } from '../src/i18n/auto';

afterEach(() => { cleanup(); useApp.getState().closeProject(); });

// A common-unit diode line followed by an opaque body, as in USBLC6.
const source = `(kicad_sch (lib_symbols (symbol "Test:ESD"
  (symbol "ESD_0_1" (polyline (pts (xy -2.54 0) (xy 2.54 0)) (fill (type none))))
  (symbol "ESD_1_1" (rectangle (start -2.54 2.54) (end 2.54 -2.54) (fill (type background)))
    (pin passive line (at -5.08 0 0) (length 2.54) (name "I/O1") (number "1"))
    (pin passive line (at 5.08 0 180) (length 2.54) (name "I/O1") (number "6")))))
  (symbol (lib_id "Test:ESD") (at 25.4 25.4 0) (unit 1) (property "Reference" "U2")))`;

it('paints the opaque body below common-unit graphics, including previously saved symbols', () => {
  const {sheet} = importKicadSchematic(source), c=sheet.components[0], sym=getSymbol(c.symbolId);
  const before=structuredClone(sym), pins=pinGeoms(c);
  expect(sym.shapes?.[0].kind).toBe('polyline');
  const view=render(<svg><SymbolGlyph comp={c} sym={sym}/></svg>);
  const shapeGroup=view.container.querySelector('g[stroke-linecap="round"]')!;
  expect(Array.from(shapeGroup.children).map(e=>e.tagName)).toEqual(['rect','path']);
  expect(orderedSymbolShapes(sym)[0]).toMatchObject({kind:'rect',fill:'background'});
  expect(symbolLocalStrokes(sym).lines[0].fill).toBe(true);
  expect(symbolLocalStrokes(sym).lines[1].fill).toBe(false);
  expect(sym).toEqual(before);expect(pinGeoms(c)).toEqual(pins);
});

it('identifies same-name ESD pins by their physical pin number', () => {
  const {sheet}=importKicadSchematic(source);
  expect(runErc(sheet).items.filter(i=>i.rule==='unconnected-pin').map(i=>i.refs)).toEqual([['U2.1 (I/O1)'],['U2.6 (I/O1)']]);
});

it('renders imported label size and alignment instead of the editor defaults', () => {
  const p=createProject({name:'Imported labels'});
  p.schematic.sheets=[importKicadSchematic(`(kicad_sch
    (global_label "USB_D+" (at 145.415 43.815 180)
      (effects (font (size 1.27 1.27)) (justify right))))`).sheet];
  useApp.getState().openProjectObject(p);
  const view=render(<SchematicCanvas/>);
  const text=Array.from(view.container.querySelectorAll('svg text')).find(t=>t.textContent==='USB_D+')!;
  expect(text.getAttribute('font-size')).toBe('50');
  expect(text.getAttribute('text-anchor')).toBe('end');
  expect(Number(text.getAttribute('x'))).toBeLessThan(p.schematic.sheets[0].labels[0].x);
});

it('keeps diagnostics live without all markers, supports locate/show-all, and resets the view for another project', () => {
  usePrefs.getState().setLocale('en');
  const p=createProject({name:'ERC markers'});p.schematic.sheets=[importKicadSchematic(source).sheet];
  useApp.getState().openProjectObject(p);
  const report=getAnalysis(p).erc;
  const view=render(<><SchematicCanvas/><CheckPanel/></>);
  const markers=()=>view.container.querySelectorAll('[data-erc-marker]');
  expect(report.warnings).toBe(2);expect(markers()).toHaveLength(0);
  expect(view.getAllByRole('button',{name:/Pin unconnected/})).toHaveLength(2);
  const toggle=view.getByRole('checkbox',{name:'Show all check markers'});
  fireEvent.click(toggle); expect(markers()).toHaveLength(2);
  fireEvent.click(toggle); expect(markers()).toHaveLength(0);
  act(()=>locateItem(report.items[0],'sch')); expect(markers()).toHaveLength(1);
  expect(getAnalysis(p).erc).toBe(report);
  act(()=>useApp.getState().set('showSchCheckMarkers',true));
  act(()=>useApp.getState().openProjectObject(createProject({name:'Another project'})));
  expect(useApp.getState().showSchCheckMarkers).toBe(false);expect(markers()).toHaveLength(0);
});

it.each(LOCALES)('localizes the power-source explanation in %s', locale => {
  expect(translateText(translate('zh-CN','erc.powerNotDriven.why'),locale)).toBe(translate(locale,'erc.powerNotDriven.why'));
  expect(translate(locale,'sch.check.markers')).toBeTruthy();
});
