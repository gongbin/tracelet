import { useRef, useState } from 'react';
import { pcb, type BoardFootprint, type Model3d } from '@tracelet/kernel';
import { useApp, useProject } from '../../store/app.js';
import { MODEL_CATALOG, modelFor, needsModel, validateGlb, loadModel, disposeObject } from './models.js';

export function ModelMatcher({ close }: { close: () => void }) {
  const project = useProject(), app = useApp();
  const groups = [...new Map(project.board.footprints.filter(needsModel).map(f => [f.footprintId, f])).values()];
  const [selected, setSelected] = useState(groups[0]?.footprintId ?? ''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const f = groups.find(f => f.footprintId === selected) as BoardFootprint | undefined;
  const config = f ? modelFor(f, project.board) : undefined;
  const save = (model?: Model3d) => { if (f) app.editor!.dispatch(pcb.setFootprintModel(f.footprintId, model)); };
  const upload = async (file?: File) => {
    if (!file || !f) return; const target = f.footprintId, editor = app.editor!;
    setBusy(true); setError('');
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('本地项目请选择不超过 2MB 的 GLB，建议先简化网格');
      const buffer = await file.arrayBuffer(); validateGlb(buffer);
      let binary = ''; const bytes = new Uint8Array(buffer); for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const source = `data:model/gltf-binary;base64,${btoa(binary)}`;
      const model = await loadModel(source); disposeObject(model);
      if (useApp.getState().editor !== editor) return;
      editor.dispatch(pcb.setFootprintModel(target, { name: file.name, source, scale: 1000, rotation: [0, 0, 0], offset: [0, 0, 0] }));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  return <div role="dialog" aria-modal="true" aria-label="3D 模型匹配" style={{ position: 'absolute', inset: 16, zIndex: 30, background: 'var(--bg-panel, #242832)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, overflow: 'auto', color: 'var(--text)' }}>
    <div className="row"><b>3D 模型匹配</b><button className="btn sm ml-auto" onClick={close}>关闭</button></div>
    <p className="dim">按封装匹配，应用于同封装的全部器件；可撤销，模型配置随项目保存。标准封装外形不等于厂商精确实物模型。</p>
    <select className="input" aria-label="选择封装" value={selected} onChange={e => { setSelected(e.target.value); setError(''); }} style={{ width: '100%' }}>
      {groups.map(g => <option key={g.footprintId} value={g.footprintId}>{g.footprintId.split(':').pop()} · {project.board.footprints.filter(f => f.footprintId === g.footprintId).map(f => f.ref).join(', ')} · {modelFor(g, project.board) ? '已匹配' : '未匹配'}</option>)}
    </select>
    {f && <><p>当前模型：{config?.name ?? '占位盒'}</p>
      <label>标准模型 <select className="input" aria-label="标准模型" value={config?.source.startsWith('catalog:') ? config.source.slice(8) : ''} onChange={e => { if (e.target.value) save({ name: e.target.value, source: `catalog:${e.target.value}`, scale: 1000, rotation: [0, 0, 0], offset: [0, 0, 0] }); }}><option value="">选择模型…</option>{Object.keys(MODEL_CATALOG).map(k => <option key={k}>{k}</option>)}</select></label>
      <div className="row" style={{ marginTop: 12 }}><button className="btn" disabled={busy} onClick={() => input.current?.click()}>{busy ? '检查模型…' : '导入 GLB'}</button><button className="btn" disabled={busy} onClick={() => save()}>恢复自动匹配</button></div>
      <input ref={input} type="file" accept=".glb" style={{ display: 'none' }} onChange={e => void upload(e.target.files?.[0])} />
      {config && <div style={{ marginTop: 16 }}><label>单位换算（glTF 米 → mm 为 1000） <input className="input" aria-label="模型缩放" type="number" min="0.001" step="1" value={config.scale} onChange={e => { const n = Number(e.target.value); if (n > 0 && Number.isFinite(n)) save({ ...config, scale: n }); }} /></label>
        {(['offset', 'rotation'] as const).map(key => <div key={key} className="row" style={{ marginTop: 8 }}><span>{key === 'offset' ? '偏移 mm' : '旋转 °'}</span>{(['X', 'Y', 'Z'] as const).map((axis, i) => <label key={axis}>{axis}<input className="input" aria-label={`${key} ${axis}`} type="number" style={{ width: 76 }} value={config[key][i]} onChange={e => { const n = Number(e.target.value); if (!Number.isFinite(n)) return; const next = [...config[key]] as [number, number, number]; next[i] = n; save({ ...config, [key]: next }); }} /></label>)}</div>)}
      </div>}
    </>}
    {error && <p role="alert" style={{ color: 'var(--error)' }}>{error}</p>}
    <p className="dim">STEP 需先在本地转换为 GLB；此处导入单文件 GLB。安装孔和裸测试点直接显示 PCB 几何，不需要元件模型。</p>
    <a href={`${import.meta.env.BASE_URL}models3d/kicad/ATTRIBUTION.md`} target="_blank" rel="noreferrer">标准模型来源与许可</a>
  </div>;
}
