import { copperLayers, pcb } from '@tracelet/kernel';
import { useApp, useEditor, useProject } from '../store/app.js';
import { useT } from '../i18n/index.js';

export function LayerCountSelect() {
  const board = useProject().board, editor = useEditor(), app = useApp(), t = useT();
  const blocked = (n: 2 | 4 | 6) => {
    const allowed = copperLayers(n);
    return board.vias.some(v => (v.startLayer && !allowed.includes(v.startLayer)) || (v.endLayer && !allowed.includes(v.endLayer)) || (v.backdrill && n!==board.copperCount)) || [...board.traces, ...board.zones].some(item => !allowed.includes(item.layer));
  };
  return <select className="input" style={{ width: 'auto' }} aria-label={t('board.layerCount')} value={board.copperCount} title={t('board.reduceLayersHint')} onChange={e => {
    const n = Number(e.target.value) as 2 | 4 | 6;
    if (blocked(n)) return;
    editor.dispatch(pcb.setCopperCount(n));
    if (app.activeLayer.endsWith('.Cu') && !copperLayers(n).some(l => l === app.activeLayer)) app.set('activeLayer', 'F.Cu');
  }}>
    {([2, 4, 6] as const).map(n => <option key={n} value={n} disabled={blocked(n)}>{t('board.layers', {count:n})}</option>)}
  </select>;
}
