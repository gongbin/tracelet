import { useState } from 'react';
import { pcb, copperLayers, validateVia, backdrillDepth, type Via, type CopperLayer } from '@tracelet/kernel';
import { useApp, useProject } from '../store/app.js';
import { usePrefs } from '../i18n/index.js';
export function ViaTechnology({via}:{via:Via}) {
 const b=useProject().board, zh=usePrefs(s=>s.locale).startsWith('zh'), layers=copperLayers(b.copperCount);
 const [draft,setDraft]=useState(via), [error,setError]=useState('');
 const update=(p:Partial<Via>)=>setDraft({...draft,...p});
 const bd=draft.backdrill;
 return <div className="col" data-no-translate style={{gap:8,marginTop:12}}>
  <strong>{zh?'过孔工艺':'Via technology'}</strong>
  {(['startLayer','endLayer'] as const).map((key,i)=><label key={key}>{zh?(i?'终止层':'起始层'):(i?'End layer':'Start layer')} <select className="input" value={draft[key]??(i?'B.Cu':'F.Cu')} onChange={e=>update({[key]:e.target.value as CopperLayer,backdrill:undefined})}>{layers.map(l=><option key={l}>{l}</option>)}</select></label>)}
  <small>{zh?'外层到内层为盲孔；内层到内层为埋孔。自动布线新增的过孔仍采用通孔。':'Outer-to-inner: blind. Inner-to-inner: buried. Autorouter-generated vias remain through vias.'}</small>
  <label><input type="checkbox" checked={!!bd} onChange={e=>update({startLayer:'F.Cu',endLayer:'B.Cu',backdrill:e.target.checked?{side:'B',stopLayer:layers[1],diameter:Math.max(via.size+.2,.8),stub:.1}:undefined})} disabled={layers.length<4}/>{zh?'背钻（通孔）':'Backdrill (through via)'}</label>
  {bd&&<>
   <select className="input" aria-label="Backdrill side" value={bd.side} onChange={e=>update({backdrill:{...bd,side:e.target.value as 'F'|'B'}})}><option value="F">F →</option><option value="B">B →</option></select>
   <label>{zh?'停止层（保留连接）':'Stop layer (retain connection)'}<select className="input" value={bd.stopLayer} onChange={e=>update({backdrill:{...bd,stopLayer:e.target.value as CopperLayer}})}>{layers.slice(1,-1).map(l=><option key={l}>{l}</option>)}</select></label>
   {(['diameter','stub'] as const).map((key,i)=><label key={key}>{zh?(i?'残桩 mm':'背钻直径 mm'):(i?'Residual stub mm':'Backdrill diameter mm')}<input className="input" type="number" min="0" step="0.01" value={bd[key]} onChange={e=>update({backdrill:{...bd,[key]:Number(e.target.value)}})}/></label>)}
   <small>{zh?'请先在层叠设置中确认各铜层深度。':'Confirm copper depths in Stackup first.'} {backdrillDepth(b,draft)?.toFixed(3)} mm</small>
  </>}
  {error&&<div role="alert">{error}</div>}
  <button className="btn" onClick={()=>{const errors=validateVia(b,draft);if(errors.length){setError(errors.join('; '));return;}useApp.getState().editor!.dispatch(pcb.setViaProps(via.id,{startLayer:draft.startLayer,endLayer:draft.endLayer,backdrill:draft.backdrill}));setError('');}}>{zh?'应用工艺':'Apply technology'}</button>
 </div>;
}
