import { sch, findPin, type ReviewSuggestion, type ProjectEditor } from '@tracelet/kernel';

/** 执行审查建议：去耦电容 / 上拉电阻，都是内核命令，可 Undo。 */
export function applySuggestion(editor: ProjectEditor, s: ReviewSuggestion): boolean {
  const act = s.action; if (!act) return false;
  const sheetId = editor.project.schematic.sheets.find((sh) => sh.components.some((c) => c.id === act.componentId))?.id ?? editor.project.schematic.sheets[0].id;
  const comp = () => editor.project.schematic.sheets.find((sh) => sh.id === sheetId)!.components;
  const c = comp().find((x) => x.id === act.componentId); if (!c) return false;
  const g = findPin(c, act.pinNumber); if (!g) return false;
  const dir = g.horizontal ? Math.sign(g.end.x - g.base.x) || 1 : 1;
  if (act.kind === 'add-decoupling') {
    editor.begin(`添加去耦电容 (${c.ref})`);
    const cap = sch.placeComponent(editor.project, { sheetId, symbolId: 'sym:C', center: { x: g.end.x + dir * 700, y: g.end.y + 400 }, value: '100nF', footprint: 'fp:C_0402' });
    editor.dispatch(cap.command);
    editor.dispatch(sch.connectPins(sheetId, { componentId: c.id, pin: act.pinNumber }, { componentId: cap.id, pin: '1' }));
    const capC = comp().find((x) => x.id === cap.id)!; const g2 = findPin(capC, '2')!;
    const gnd = sch.placeComponent(editor.project, { sheetId, symbolId: 'sym:GND', center: { x: g2.end.x, y: g2.end.y + 300 }, value: 'GND' });
    editor.dispatch(gnd.command);
    editor.dispatch(sch.connectPins(sheetId, { componentId: cap.id, pin: '2' }, { componentId: gnd.id, pin: '1' }));
    editor.commit();
    return true;
  }
  if (act.kind === 'add-pullup') {
    editor.begin(`添加上拉电阻 (${c.ref})`);
    const r = sch.placeComponent(editor.project, { sheetId, symbolId: 'sym:R', center: { x: g.end.x + dir * 700, y: g.end.y - 500 }, value: '10kΩ', footprint: 'fp:R_0402' });
    editor.dispatch(r.command);
    editor.dispatch(sch.connectPins(sheetId, { componentId: c.id, pin: act.pinNumber }, { componentId: r.id, pin: '2' }));
    const rC = comp().find((x) => x.id === r.id)!; const g1 = findPin(rC, '1')!;
    const pwr = sch.placeComponent(editor.project, { sheetId, symbolId: 'sym:PWR', center: { x: g1.end.x, y: g1.end.y - 300 }, value: '+3V3' });
    editor.dispatch(pwr.command);
    editor.dispatch(sch.connectPins(sheetId, { componentId: r.id, pin: '1' }, { componentId: pwr.id, pin: '1' }));
    editor.commit();
    return true;
  }
  return false;
}
