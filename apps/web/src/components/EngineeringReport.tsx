import { locateItem } from '../panels/CheckPanel.js';
import {useMemo} from 'react';
import {engineeringReport,type EngineeringIssue} from '@tracelet/kernel';
import {useApp,useProject} from '../store/app.js';
import {getAnalysis} from '../store/analysis.js';
import {usePrefs} from '../i18n/index.js';
import {DiagnosticText} from '../i18n/DiagnosticText.js';

export function EngineeringReport(){
 const project=useProject(), locale=usePrefs(s=>s.locale), zh=locale.startsWith('zh'), app=useApp();
 const r=useMemo(()=>engineeringReport(project,getAnalysis(project)),[project]);
 const n=(value:number|null,digits=1)=>value===null?'—':new Intl.NumberFormat(locale,{maximumFractionDigits:digits}).format(value);
 const names=zh?{manufacturing:'可制造性',layout:'布局',routing:'布线完成度',signal:'信号约束',impedance:'阻抗验证',appearance:'整齐度'}:{manufacturing:'Manufacturability',layout:'Placement',routing:'Routing completion',signal:'Signal constraints',impedance:'Impedance verification',appearance:'Alignment'};
 const scope=zh?{
  manufacturing:'依据当前板厂规则的 DRC。每项错误扣 15 分，警告扣 3 分。',
  layout:'重叠、出界、间距、接口朝向、去耦与晶振距离等启发式检查。每 10 个元件：错误 −15，警告 −4，提示 −1（不足 10 个按 10 个计）。',
  routing:'100 × 已连接数 / 总连接数（向下取整）；无网络走线每项扣 5 分，最多扣 20 分。线长和过孔数只展示，不据此判断最优。',
  signal:'只评价已配置的层、长度、缩颈及差分/参考面筛查。错误 −15，警告 −5。无约束或未布通时不评分；不代表串扰、EMI 或回流连续性验证。',
  impedance:'现有参数未关联到实际走线和完整场模型，因此不给全板阻抗评分。下表仅展示已保存参数的近似计算。',
  appearance:'相邻同类元件的对齐与朝向一致性，每 10 个元件每项扣 2 分（不足 10 个按 10 个计）。属于辅助指标，不代表机械或电气正确性。'
 }:{
  manufacturing:'Current fabrication-rule DRC: −15 per error, −3 per warning.',
  layout:'Heuristic overlap, outline, spacing, connector, decoupling and crystal checks: −15/error, −4/warning, −1/info per 10 components (minimum 10).',
  routing:'Floor of connected / total × 100, minus 5 per unassigned trace (maximum 20). Length and via count are descriptive, not proof of optimal routing.',
  signal:'Configured layer, length, neckdown, differential and reference-plane checks only: −15/error, −5/warning. Unassessed without constraints or complete routing. No crosstalk, EMI or return-path certification.',
  impedance:'Profiles are not associated with actual traces and a field model, so board impedance remains unassessed. Saved profile estimates appear below.',
  appearance:'Nearby component alignment and orientation: −2 per issue per 10 components (minimum 10). Cosmetic guidance, not electrical or mechanical validation.'
 };
 const locate=(issue:EngineeringIssue)=>{
  const ids=issue.objectIds?.length?issue.objectIds:project.board.footprints.filter(f=>issue.refs.includes(f.ref)).map(f=>f.id);
  const fp=project.board.footprints.find(f=>ids?.includes(f.id));const point=issue.location??(fp?{x:fp.x,y:fp.y}:undefined);
  app.go('pcb');app.patch({rightTab:'check',pcbSelection:ids?.slice(0,1)??[],highlightNet:issue.refs.find(ref=>project.board.traces.some(t=>t.net===ref))??null,...(point?{flyTo:{...point,space:'pcb' as const,seq:Date.now()}}:{})});
 };
 const exportReport=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(r,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='tracelet-engineering-report.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 const facts=zh?[
  ['元件',r.facts.components,''],['铜层',r.facts.layers,''],['连接完成率',r.facts.completion,'%'],['未布线',r.facts.unrouted,` / ${r.facts.totalConnections}`],['走线总长',r.facts.traceLength,' mm'],['过孔',r.facts.vias,''],['DRC 错误',r.facts.drcErrors,''],['DRC 警告',r.facts.drcWarnings,''],['布局重叠项',r.facts.overlaps,''],['出界项',r.facts.outside,''],['信号约束组',r.facts.signalConfigured,''],['非 0/45/90° 线段',r.facts.non45,` / ${r.facts.segments}`]
 ]:[['Components',r.facts.components,''],['Copper layers',r.facts.layers,''],['Connected',r.facts.completion,'%'],['Unrouted',r.facts.unrouted,` / ${r.facts.totalConnections}`],['Trace length',r.facts.traceLength,' mm'],['Vias',r.facts.vias,''],['DRC errors',r.facts.drcErrors,''],['DRC warnings',r.facts.drcWarnings,''],['Overlap issues',r.facts.overlaps,''],['Outside issues',r.facts.outside,''],['Constraint groups',r.facts.signalConfigured,''],['Non-45° segments',r.facts.non45,` / ${r.facts.segments}`]];
 return <section className="engineering-report" data-no-translate>
  <div className="row" style={{justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><h2>{zh?'工程评估报告':'Engineering assessment'}</h2><button className="btn sm" onClick={exportReport}>{zh?'导出报告 JSON':'Export report JSON'}</button></div>
  <p className="muted">{project.name} · {r.ruleSet} · {zh?'随当前工程自动更新 · 评分规则 v1':'Updates with the current project · Scoring v1'}</p>
  <div className="engineering-summary"><strong style={{fontSize:36}}>{n(r.score,0)}<small style={{fontSize:14}}> / 100</small></strong><div><strong>{zh?'已评估项目综合分':'Assessed checks score'}</strong><div>{zh?`${r.assessed}/6 个维度已评分；未评估项不计入平均分。`:`${r.assessed}/6 categories scored; unassessed checks excluded.`}</div><div style={{color:r.blockers.length?'var(--error, #EB685F)':'var(--text-2)'}}>{r.blockers.length?(zh?`存在制造阻断项：${r.blockers.map(k=>({empty:'空板',outline:'板框不足',unrouted:'未布通',drc:'DRC 错误',erc:'ERC 错误'}[k])).join('、')}`:`Blocking checks: ${r.blockers.join(', ')}`):(zh?'自动检查未发现阻断项，仍需工程复核':'No automated blocking checks; engineering review still required')}</div></div></div>
  <p className="muted">{zh?'这是基于几何和已配置规则的辅助评估，不是打板许可或信号完整性认证。高分不能抵消 DRC 错误；非 45° 走线、线长和过孔数量没有统一的优劣阈值。':'Geometry and configured-rule assessment, not fabrication approval or SI certification. A high score cannot override DRC errors. Angles, trace length and via count have no universal quality threshold.'}</p>
  <div className="engineering-facts">{facts.map(([label,value,unit])=><div key={String(label)}><small className="muted">{label}</small><strong>{n(value as number|null)}{unit}</strong></div>)}</div>
  <article className="card" style={{padding:16,marginBottom:18}}>
    <div className="row" style={{justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><strong>{zh?'原理图电气规则检查（ERC）':'Schematic electrical rules check (ERC)'}</strong><strong>{r.erc.report?(zh?`${r.erc.report.errors} 错误 · ${r.erc.report.warnings} 警告`:`${r.erc.report.errors} errors · ${r.erc.report.warnings} warnings`):(zh?'未评估：没有原理图元件':'Unassessed: no schematic components')}</strong></div>
    <p className="small muted">{zh?'ERC 检查原理图的输出冲突、电源驱动、重复位号、悬空引脚和网络标签等；DRC 检查 PCB 的物理规则。ERC 错误单独列为阻断项，不混入 PCB 几何评分。没有原理图时不视为 ERC 通过。':'ERC checks schematic output conflicts, power drivers, duplicate references, unconnected pins and net labels. DRC checks physical PCB rules. ERC errors are separate blockers and do not alter the PCB geometry score. Missing schematics do not count as an ERC pass.'}</p>
    <small className="muted">{zh?'检查依赖符号引脚类型和不连接标记的准确性；没有错误也不代表电路功能或仿真通过。':'Results depend on correct symbol pin types and no-connect markers; zero errors is not functional or simulation verification.'}</small>
    {r.erc.report&&r.erc.report.items.length>0&&<details><summary>{zh?'查看 ERC 详情':'View ERC findings'} ({r.erc.report.items.length})</summary><div className="engineering-issues">{r.erc.report.items.map(issue=><div key={issue.id}><strong>{zh?(issue.severity==='error'?'错误':'警告'):issue.severity} · </strong><DiagnosticText>{issue.message}</DiagnosticText><p className="small"><DiagnosticText>{issue.why}</DiagnosticText></p><small className="muted">{issue.refs.join(', ')}{issue.sheetId?` · ${project.schematic.sheets.find(s=>s.id===issue.sheetId)?.name??issue.sheetId}`:''}</small><div><button className="btn sm" onClick={()=>locateItem(issue,'sch')}>{zh?'在原理图中查看':'View in schematic'}</button></div></div>)}</div></details>}
  </article>
  <div className="engineering-categories">{r.categories.map(c=><article className="card" key={c.id} style={{padding:14,minWidth:0}}><div className="row" style={{justifyContent:'space-between'}}><strong>{names[c.id]}</strong><strong>{c.score===null?(zh?'未评估':'Unassessed'):`${c.score}/100`}</strong></div>{c.score!==null&&<progress max={100} value={c.score} style={{width:'100%',marginTop:10}}/>}<p className="small muted">{scope[c.id]}</p><small>{zh?`权重 ${c.weight} · ${c.issues.length} 个发现`:`Weight ${c.weight} · ${c.issues.length} findings`}</small>{c.issues.length>0&&<details><summary>{zh?'查看详情与扣分':'Findings and deductions'}</summary><div className="engineering-issues">{c.issues.map((issue,i)=><div key={i}><div className="row" style={{justifyContent:'space-between',gap:8}}><span><DiagnosticText>{issue.message}</DiagnosticText></span><strong style={{whiteSpace:'nowrap'}}>{c.score===null?'—':`−${n(issue.deduction,2)}`}</strong></div><small className="muted">{issue.rule} · {issue.refs.join(', ')}</small>{issue.suggestion&&<p className="small"><DiagnosticText>{issue.suggestion}</DiagnosticText></p>}<button className="btn sm" onClick={()=>locate(issue)}>{zh?'在 PCB 中查看':'View in PCB'}</button></div>)}</div></details>}</article>)}</div>
  <details><summary>{zh?'逐网络线长、线段与过孔':'Per-net lengths, segments and vias'} ({r.nets.length})</summary><div style={{overflowX:'auto'}}><table className="engineering-table"><thead><tr>{(zh?['网络','长度 mm','线段','过孔','分层长度 mm']:['Net','Length mm','Segments','Vias','Length by layer mm']).map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>{r.nets.map(net=><tr key={net.net}><td><button className="btn sm" onClick={()=>{app.go('pcb');app.set('highlightNet',net.net);}}>{net.net||'—'}</button></td><td>{n(net.length)}</td><td>{net.segments}</td><td>{net.vias}</td><td>{Object.entries(net.byLayer).map(([l,v])=>`${l}: ${n(v!)}`).join(' · ')}</td></tr>)}</tbody></table></div></details>
  <details><summary>{zh?'已保存的阻抗参数估算':'Saved impedance profile estimates'} ({r.impedance.length})</summary>{r.impedance.length===0?<p>{zh?'尚未保存阻抗参数。可在“层叠与工艺”中设置。':'No profiles saved. Configure them in Stackup.'}</p>:<div style={{overflowX:'auto'}}><table className="engineering-table"><thead><tr>{(zh?['模型','w / h / t mm','εr','目标 Ω','估算 Ω','偏差 %']:['Model','w / h / t mm','εr','Target Ω','Estimate Ω','Deviation %']).map(s=><th key={s}>{s}</th>)}</tr></thead><tbody>{r.impedance.map((p,i)=><tr key={i}><td>{p.kind}</td><td>{p.width} / {p.height} / {p.thickness}</td><td>{p.er}</td><td>{p.target}</td><td>{n(p.ohms)}</td><td>{n(p.deviationPercent)}</td></tr>)}</tbody></table></div>}</details>
  <details><summary>{zh?'评分口径与限制':'Scoring method and limitations'}</summary><p>{zh?'各项最低为 0 分。综合分按已评估维度的权重加权并四舍五入，缺失维度不补满分。当前不评估实际串扰、EMI、热、电源完整性、机械外壳配合或加工公差；阻抗参数估算不进入综合分。':'Each category floors at zero. Overall score is a rounded weighted mean of assessed categories. Missing evidence earns no score. No actual crosstalk, EMI, thermal, power-integrity, enclosure-fit or manufacturing-tolerance validation. Impedance estimates do not contribute to the score.'}</p></details>
 </section>;
}
