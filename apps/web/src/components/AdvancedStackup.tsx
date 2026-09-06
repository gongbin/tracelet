import { useState } from 'react';
import { pcb, copperLayers, copperDepths, estimateImpedance, type ImpedanceInput } from '@tracelet/kernel';
import { useApp, useProject } from '../store/app.js';
import { usePrefs } from '../i18n/index.js';
export function AdvancedStackup(){
 const b=useProject().board, zh=usePrefs(s=>s.locale).startsWith('zh');
 const [depths,setDepths]=useState(b.stackup?.copperDepths?.join(', ')??'');
 const saved=b.stackup?.impedanceProfiles?.[0];
 const [p,setP]=useState<ImpedanceInput>(saved??{kind:'microstrip',width:.2,height:.15,thickness:.035,er:4.2});
 const [target,setTarget]=useState(saved?.target??50), [error,setError]=useState('');
 let z:number|null=null;try{z=estimateImpedance(p);}catch{}
 const save=(patch:Parameters<typeof pcb.setBoardProps>[0])=>useApp.getState().editor!.dispatch(pcb.setBoardProps(patch));
 return <div className="col" data-no-translate style={{gap:8,marginTop:16}}>
  <strong>{zh?'铜层深度与阻抗估算':'Copper depths and impedance estimate'}</strong>
  <small>{zh?'输入板厂确认的铜层深度（从顶面起，mm，逗号分隔；首层 0，末层等于板厚）。':'Enter fabricator-confirmed copper depths from top, mm, comma-separated; first 0, last equals board thickness.'} {copperLayers(b.copperCount).join(' → ')}</small>
  <input className="input" aria-label="Copper depths mm" placeholder={`0, …, ${b.thickness}`} value={depths} onChange={e=>setDepths(e.target.value)}/>
  <button className="btn" onClick={()=>{const d=depths.split(',').map(Number);if(!copperDepths({...b,stackup:{...b.stackup!,copperDepths:d}})){setError(zh?'深度数量或顺序不正确':'Invalid depth count or order');return;}save({stackup:{copperDepths:d}});setError('');}}>{zh?'保存确认深度':'Save confirmed depths'}</button>
  <select className="input" aria-label="Impedance geometry" value={p.kind} onChange={e=>setP({...p,kind:e.target.value as ImpedanceInput['kind']})}><option value="microstrip">{zh?'单端微带线':'Single-ended microstrip'}</option><option value="stripline">{zh?'对称带状线':'Centered stripline'}</option></select>
  <small>{zh?'h：微带线为介质厚度；带状线为两参考平面间距，信号线居中。':'h: microstrip dielectric thickness; stripline total plane separation with centered signal.'}</small>
  <div className="row" style={{gap:8,flexWrap:'wrap'}}>{(['width','height','thickness','er'] as const).map((k,i)=><label key={k}>{['w mm','h mm','t mm','εr'][i]}<input className="input" type="number" min="0.001" step="0.01" style={{width:90}} value={p[k]} onChange={e=>setP({...p,[k]:Number(e.target.value)})}/></label>)}
   <label>{zh?'目标 Ω':'Target Ω'}<input className="input" type="number" style={{width:90}} value={target} onChange={e=>setTarget(Number(e.target.value))}/></label>
  </div>
  <strong>{z===null?(zh?'参数无效':'Invalid geometry'):`Z₀ ≈ ${z.toFixed(1)} Ω`}</strong>
  <small>{zh?'工程近似，主要用于 50–100 Ω。未包含阻焊、粗糙度、频率效应、差分耦合及参考面缺口；不是场求解器。参数需由板厂确认。':'Engineering approximation, primarily 50–100 Ω. Excludes mask, roughness, frequency effects, differential coupling and plane gaps; not a field solver. Confirm with fabricator.'}</small>
  <button className="btn" disabled={z===null||!Number.isFinite(target)||target<=0} onClick={()=>save({stackup:{impedance:true,impedanceProfiles:[{...p,target}]}})}>{zh?'保存阻抗参数至制造说明':'Save impedance profile for fabrication'}</button>
  {error&&<span role="alert">{error}</span>}
 </div>;
}
