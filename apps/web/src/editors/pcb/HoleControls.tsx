import { SCREW_HOLES } from '@tracelet/kernel';
import { useState } from 'react';
import { useApp } from '../../store/app.js';
import { useT } from '../../i18n/index.js';

export function HoleControls({nets}:{nets:string[]}){
  const app=useApp(),t=useT(),h=app.hole,half=h.mode==='castellated';
  const [expanded,setExpanded]=useState(true);
  const number=(key:'drill'|'ring'|'count'|'pitch',label:string,value:number,min:number,max:number,step:number)=><label>{label}<input aria-label={label} className="input mono" type="number" key={`${half}:${key}:${value}`} defaultValue={value} min={min} max={max} step={step} onBlur={e=>{const v=e.target.valueAsNumber;if(Number.isFinite(v)&&v>=min&&v<=max)app.set('hole',{...h,[key]:v});else e.target.value=String(value);}} onKeyDown={e=>{e.stopPropagation();if(e.key==='Enter')e.currentTarget.blur();}}/></label>;
  return <div className="pcb-assist pcb-hole-controls" data-no-translate onPointerDown={e=>e.stopPropagation()}>
    <div className="row" style={{flexWrap:'wrap'}}>
      <button className="btn sm" aria-expanded={expanded} aria-controls="pcb-hole-options" onClick={()=>setExpanded(v=>!v)}><strong>{t('pcb.hole.title')}</strong> {expanded?'▾':'▸'}</button>
      <button className="btn sm" aria-pressed={!half} onClick={()=>app.set('hole',{...h,mode:'round',drill:3.2})}>{t('pcb.hole.round')}</button>
      <button className="btn sm" aria-pressed={half} onClick={()=>app.set('hole',{...h,mode:'castellated',drill:.8,ring:.4,plated:true,count:4,pitch:2.54})}>{t('pcb.hole.half')}</button>
      <button className="btn sm" onClick={()=>{app.go('fab');app.set('fabPanelOpen',true);}}>{t('pcb.hole.mouseBites')}</button>
    </div>
    {expanded&&<div id="pcb-hole-options"><div className="row" style={{flexWrap:'wrap',gap:10}}>
      {!half&&SCREW_HOLES.map(p=><button className="btn sm" key={p.label} onClick={()=>app.set('hole',{...h,drill:p.drill})}>{p.label}</button>)}
      {number('drill',t('pcb.hole.drill'),h.drill,half?.5:.3,20,.1)}
      {!half&&<label><input type="checkbox" checked={h.plated} onChange={e=>app.set('hole',{...h,plated:e.target.checked})}/>{t('pcb.hole.plated')}</label>}
      {h.plated&&number('ring',t('pcb.hole.ring'),h.ring,half?.25:.15,3,.05)}
      {half&&<>{number('count',t('pcb.hole.count'),h.count??4,1,40,1)}{number('pitch',t('pcb.hole.pitch'),h.pitch??2.54,.5,20,.1)}</>}
      {h.plated&&<label>{t('pcb.hole.net')}<select className="input" aria-label={t('pcb.hole.net')} value={h.net??''} onChange={e=>app.set('hole',{...h,net:e.target.value})}><option value="">{t('pcb.hole.isolated')}</option>{nets.map(n=><option key={n}>{n}</option>)}</select></label>}
    </div>
    <div className="dim">{t(half?'pcb.hole.halfHint':'pcb.hole.hint')}</div></div>}
  </div>;
}
