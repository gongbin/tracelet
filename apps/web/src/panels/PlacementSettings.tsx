import type { BoardFootprint } from '@tracelet/kernel';
import { pcb, footprintPads } from '@tracelet/kernel';
import { useEditor, useProject } from '../store/app.js';
import { useT } from '../i18n/index.js';

/** All changes use commands, so constraints survive saving and support undo. */
export function PlacementSettings({ fp }: { fp: BoardFootprint }) {
  const project = useProject(), editor = useEditor(), t = useT();
  const c = fp.placement ?? {};
  const update = (patch: Partial<NonNullable<BoardFootprint['placement']>>) =>
    editor.dispatch(pcb.setPlacementConstraints(fp.id, { ...c, ...patch }));
  const nets = new Set(footprintPads(fp, project.board).map(p => p.net).filter(Boolean));
  const targetCandidates = project.board.footprints.filter(f => f.id !== fp.id).flatMap(f =>
    footprintPads(f, project.board).filter(p => !p.def.npth && nets.has(p.net)).map(p => ({value:JSON.stringify([f.id,p.number]),label:f.ref+'.'+p.number+' · '+p.net})));
  const targets = [...new Map(targetCandidates.map(p => [p.value,p])).values()];
  return <fieldset style={{border:0,padding:0,minWidth:0}} data-no-translate>
    <legend>{t('placement.title')}</legend>
    <div className="kv">
      <label htmlFor="placement-fixed">{t('placement.fixed')}</label>
      <input id="placement-fixed" type="checkbox" checked={!!c.fixed || !!fp.locked} disabled={fp.locked} onChange={e => update({fixed:e.target.checked})}/>
      <label htmlFor="placement-role">{t('placement.role')}</label>
      <select id="placement-role" className="input" value={c.role ?? 'auto'} onChange={e => update({role:e.target.value as typeof c.role})}>
        {(['auto','mechanical','decoupling','connector'] as const).map(role => <option key={role} value={role}>{t(`placement.${role}`)}</option>)}
        <option value="ic">IC</option><option value="passive">R / C / L</option>
      </select>
      <label htmlFor="placement-group">{t('placement.group')}</label>
      <input id="placement-group" className="input" key={fp.id+':'+(c.group??'')} defaultValue={c.group ?? ''} onBlur={e => {if(e.target.value !== (c.group??'')) update({group:e.target.value || undefined});}}/>
      <label htmlFor="placement-target">{t('placement.target')}</label>
      <select id="placement-target" className="input" value={c.target ? JSON.stringify([c.target.footprintId,c.target.pad]) : ''} onChange={e => {
        const selected=e.target.value ? JSON.parse(e.target.value) as [string,string] : null;
        update({target:selected ? {footprintId:selected[0],pad:selected[1],maxDistance:c.target?.maxDistance??3} : undefined});
      }}><option value="">{t('placement.auto')}</option>{targets.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select>
      {c.target && <><label htmlFor="placement-distance">{t('placement.distance')}</label><input id="placement-distance" type="number" className="input" min=".1" step=".1" value={c.target.maxDistance} onChange={e => {const n=Number(e.target.value);if(n>0)update({target:{...c.target!,maxDistance:n}});}}/></>}
      <label htmlFor="placement-edge">{t('placement.edge')}</label>
      <select id="placement-edge" className="input" value={c.edge?.index ?? ''} onChange={e => update({edge:e.target.value === '' ? undefined : {index:Number(e.target.value),direction:c.edge?.direction??0,distance:2}})}>
        <option value="">{t('placement.auto')}</option>{project.board.outline.map((p,i) => <option key={i} value={i}>{i+1}: ({p.x.toFixed(1)}, {p.y.toFixed(1)})</option>)}
      </select>
      {c.edge && <><label htmlFor="placement-direction">{t('placement.direction')}</label><select id="placement-direction" className="input" value={c.edge.direction} onChange={e => update({edge:{...c.edge!,direction:Number(e.target.value)}})}>{[0,90,180,270].map(n=><option key={n} value={n}>{n}°</option>)}</select></>}
    </div>
  </fieldset>;
}
