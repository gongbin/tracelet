import { useEffect, useRef, useState } from 'react';
import { command, tidySchematic, tidySchematicTexts, assertElectricalIdentity, type Schematic } from '@tracelet/kernel';
import { useApp, useEditor, useSheet } from '../store/app.js';
import { useT } from '../i18n/index.js';

export function SchematicTidy() {
  const editor = useEditor(), app = useApp(), sheet = useSheet(), t = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<{ source: Schematic; schematic: Schematic; movedTexts: number; groups: number; cleanedWires: number; textOnly: boolean } | null>(null);
  useEffect(() => { setOpen(false); setResult(null); }, [sheet.id, editor]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape, true); };
  }, [open]);
  const prepare = (textOnly: boolean) => {
    try {
      const source = editor.project.schematic;
      const r = textOnly ? { ...tidySchematicTexts(source, sheet.id), groups: 0, cleanedWires: 0 } : tidySchematic(source, sheet.id);
      setResult({ ...r, source, textOnly });
    } catch (e) { app.toast(String(e), 'error'); }
  };
  return <div ref={root} style={{ position: 'relative', flex: 'none' }}>
    <button className="btn sm" aria-expanded={open} onClick={() => { setOpen(!open); setResult(null); }}>{t('sch.tidy.title')}</button>
    {open && <div className="sch-tidy-menu" role="dialog" aria-label={t('sch.tidy.title')}>
      <div className="row" style={{ justifyContent: 'space-between' }}><strong>{t('sch.tidy.title')}</strong><button className="btn sm quiet" aria-label={t('sch.tidy.close')} onClick={() => setOpen(false)}>×</button></div>
      <p className="muted">{t('sch.tidy.help')}</p>
      <div className="col" style={{ gap: 6 }}><button className="btn sm" onClick={() => prepare(true)}>{t('sch.tidy.textOnly')}</button><button className="btn sm" onClick={() => prepare(false)}>{t('sch.tidy.full')}</button></div>
      {result && <div className="col" style={{ gap: 8, marginTop: 12 }}>
        <span>{t('sch.tidy.stats', { texts: result.movedTexts, wires: result.cleanedWires, groups: result.groups })}</span>
        <span className="muted">{t('sch.tidy.verified')}</span>
        <button className="btn sm primary" onClick={() => {
          if (editor.project.schematic !== result.source) { app.toast(t('sch.tidy.stale'), 'error'); setResult(null); return; }
          editor.dispatch(command('Schematic cleanup', p => { assertElectricalIdentity(p.schematic, result.schematic); return { ...p, schematic: result.schematic }; }));
          if (!result.textOnly) app.set('fitSeq', app.fitSeq + 1);
          app.toast(t('sch.tidy.done'), 'success'); setResult(null); setOpen(false);
        }}>{t('sch.tidy.apply')}</button>
      </div>}
    </div>}
  </div>;
}
