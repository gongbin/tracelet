import { useMemo, useState } from 'react';
import { planPanel, ruleSetOf, exportPanelFiles, zipFiles, type FabFile, type PanelOptions } from '@tracelet/kernel';
import { useApp, useProject } from '../store/app.js';
import { usePrefs } from '../i18n/index.js';
import { GerberPreview } from '../editors/pcb/GerberPreview.js';
export function Panelization(){
  const p=useProject(),app=useApp(),zh=usePrefs(s=>s.locale).startsWith('zh');
  const [options,setOptions]=useState<PanelOptions>({columns:2,rows:1,gap:5,rail:5,tabWidth:3});
  const [files,setFiles]=useState<FabFile[]|null>(null);
  const result=useMemo(()=>{try{return {plan:planPanel(p.board,options,ruleSetOf(p)),error:''};}catch(e){return {plan:null,error:String(e)};}},[p,options]);
  const plan=result.plan, errors=plan?.errors??[result.error];
  const build=(download:boolean)=>{try{const files=exportPanelFiles(p,options);if(!download){setFiles(files);return;}const data=zipFiles(files);const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([new Uint8Array(data).buffer],{type:'application/zip'}));a.download=`${p.name}-panel.zip`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}catch(e){app.toast(String(e),'error');}};
  return <details><summary>{zh?'拼板 · 独立制造输出':'Panelization · separate fabrication output'}</summary><div className="col" style={{gap:12,paddingTop:12}}>
  <div className="row" style={{flexWrap:'wrap'}}>{(Object.keys(options) as (keyof PanelOptions)[]).map((k,i)=><label key={k}>{zh?['列','行','间隔 mm','工艺边 mm','连接桥 mm'][i]:k}<input className="input" type="number" style={{width:75}} value={options[k]} onChange={e=>setOptions({...options,[k]:e.target.valueAsNumber})}/></label>)}</div>
  <p className="small muted">{zh?'保留原始板子。按实际板框和天线、接口位置检查连接桥；采用整排工艺边、鼠咬孔、三枚定位孔和三枚顶层基准点。当前支持同向阵列和通孔工艺。':'Original board is preserved. Checks tabs against actual outline, antennas and connectors. Continuous row rails, mouse bites, three tooling holes and three top fiducials. Currently supports same-orientation arrays and through drilling.'}</p>
  {plan && <svg viewBox={`-2 -2 ${plan.width+4} ${plan.height+4}`} style={{width:'100%',maxHeight:300,background:'#151c22'}} aria-label="Panel preview">{plan.rails.map((r,i)=><rect key={`r${i}`} {...r} width={r.w} height={r.h} fill="#516454"/>)}{plan.instances.map(i=><polygon key={i.id} points={i.outline.map(p=>`${p.x},${p.y}`).join(' ')} fill="#184b31" stroke="#b8ce85" strokeWidth={0.2}/>)}{plan.tabs.map((r,i)=><rect key={`t${i}`} x={r.x} y={r.y} width={r.w} height={r.h} fill="#daa447"/>)}{plan.fiducials.map((p,i)=><circle key={`f${i}`} {...{cx:p.x,cy:p.y}} r={0.5} fill="#eac36f"/>)}</svg>}
  {errors.length>0 && <div role="alert">{errors.slice(0,10).map((s,i)=><div key={i}>{s}</div>)}</div>}
  <div className="row"><button className="btn" disabled={errors.length>0} onClick={()=>build(false)}>{zh?'回读拼板 Gerber':'Read back panel Gerber'}</button><button className="btn" disabled={errors.length>0} onClick={()=>build(true)}>{zh?'下载拼板制造包':'Download panel fabrication ZIP'}</button></div>
  {files && <GerberPreview suppliedFiles={files} onClose={()=>setFiles(null)}/>}
  </div></details>;
}
