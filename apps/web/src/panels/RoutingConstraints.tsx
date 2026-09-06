import { pcb, copperLayers, type CopperLayer, type NetClass } from '@tracelet/kernel';
import { useEditor, useProject } from '../store/app.js';
import { useT } from '../i18n/index.js';

export function RoutingConstraints() {
  const editor=useEditor(), {board}=useProject(), t=useT();
  return <div data-no-translate>{board.netClasses.map((nc,index)=>{
    const update=(patch:Partial<NetClass>)=>editor.dispatch(pcb.setNetClassConstraints(index,{allowedLayers:nc.allowedLayers,maxLength:nc.maxLength,neckdown:nc.neckdown,referenceLayer:nc.referenceLayer,referenceNet:nc.referenceNet,...patch}));
    const neck=nc.neckdown;
    return <details key={index} style={{marginBottom:8}}><summary>{nc.name} · {nc.traceWidth} mm</summary>
      <div className="col" style={{gap:8,paddingTop:8}}>
        <span>{t('routing.layers')}</span>
        <div className="row">{copperLayers(board.copperCount).map(layer=><label key={layer}><input type="checkbox" checked={!nc.allowedLayers || nc.allowedLayers.includes(layer)} onChange={e=>{
          const old=nc.allowedLayers??copperLayers(board.copperCount),next=e.target.checked?[...old,layer]:old.filter(l=>l!==layer);
          if(next.length)update({allowedLayers:next});
        }}/>{layer}</label>)}</div>
        <label>{t('routing.maxLength')} <input className="input" type="number" min="0.01" step="0.1" placeholder="—" value={nc.maxLength??''} onChange={e=>{const n=Number(e.target.value);if(!e.target.value||n>0)update({maxLength:e.target.value?n:undefined});}}/></label>
        <label>{t('routing.neckdown')} <select className="input" value={!neck?'auto':neck.allowed?'limited':'off'} onChange={e=>update({neckdown:e.target.value==='auto'?undefined:{allowed:e.target.value==='limited',minWidth:Math.min(nc.traceWidth,.2),maxLength:3}})}>
          <option value="auto">{t('routing.legacy')}</option><option value="limited">{t('routing.limited')}</option><option value="off">{t('routing.disabled')}</option>
        </select></label>
        {neck?.allowed && <><label>{t('routing.minWidth')} <input className="input" type="number" min="0.01" step="0.01" value={neck.minWidth} onChange={e=>{const n=Number(e.target.value);if(n>0)update({neckdown:{...neck,minWidth:n}});}}/></label>
        <label>{t('routing.narrowLength')} <input className="input" type="number" min="0" step="0.1" value={neck.maxLength} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n)&&n>=0)update({neckdown:{...neck,maxLength:n}});}}/></label></>}
        <label>{t('routing.referenceLayer')} <select className="input" value={nc.referenceLayer??''} onChange={e=>update({referenceLayer:(e.target.value||undefined) as CopperLayer|undefined})}><option value="">—</option>{copperLayers(board.copperCount).map(l=><option key={l}>{l}</option>)}</select></label>
        <label>{t('routing.referenceNet')} <input className="input" value={nc.referenceNet??''} onChange={e=>update({referenceNet:e.target.value||undefined})}/></label>
        <span className="dim">{t('routing.lengthHint')}</span>
      </div>
    </details>;
  })}<DifferentialPairs /></div>;
}

function DifferentialPairs(){
  const editor=useEditor(),{board}=useProject(),t=useT();
  const pairs=board.differentialPairs??[];
  const nets=[...new Set(board.footprints.flatMap(f=>Object.values(f.padNets)).filter(Boolean))].sort();
  const set=(next:typeof pairs)=>editor.dispatch(pcb.setDifferentialPairs(next));
  return <details><summary>{t('routing.pairs')}</summary><div className="col" style={{gap:8}}>
    <span className="dim">{t('routing.screening')}</span>
    {pairs.map((pair,i)=><fieldset key={i} className="col" style={{gap:6}}>
      {(['positive','negative'] as const).map(field=><label key={field}>{field==='positive'?'+':'−'} <select className="input" value={pair[field]} onChange={e=>{const name=e.target.value;if(name!==pair[field==='positive'?'negative':'positive'])set(pairs.map((p,j)=>i===j?{...p,[field]:name}:p));}}>{[...new Set([...nets,pair[field]])].map(n=><option key={n}>{n}</option>)}</select></label>)}
      {(['maxSkew','gap','tolerance'] as const).map(field=><label key={field}>{t(`routing.${field}`)} (mm) <input className="input" type="number" step="0.01" min={field==='gap'?.01:0} value={pair[field]} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n)&&(field==='gap'?n>0:n>=0))set(pairs.map((p,j)=>i===j?{...p,[field]:n}:p));}}/></label>)}
      <button className="btn sm" onClick={()=>set(pairs.filter((_,j)=>j!==i))}>−</button>
    </fieldset>)}
    <button className="btn sm" disabled={nets.length<2} onClick={()=>set([...pairs,{positive:nets[0],negative:nets[1],maxSkew:.5,gap:.2,tolerance:.05}])}>+</button>
  </div></details>;
}
