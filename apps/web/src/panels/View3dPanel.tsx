import { pcb, DEFAULT_STACKUP, type Stackup } from '@tracelet/kernel';
import { use3d, MASK_COLORS } from '../editors/three/ThreeView.js';
import { useApp, useEditor, useProject } from '../store/app.js';

const FINISH: [Stackup['finish'], string][] = [['HASL', 'HASL'], ['LeadFreeHASL', '无铅 HASL'], ['ENIG', 'ENIG'], ['OSP', 'OSP']];

export function View3dPanel() {
  const s = use3d();
  const app = useApp();
  const project = useProject();
  const editor = useEditor();
  const st: Stackup = { ...DEFAULT_STACKUP, ...(project.board.stackup ?? {}) };
  const set = (patch: Partial<Stackup>) => editor.dispatch(pcb.setBoardProps({ stackup: patch }));
  const toggles: [keyof typeof s, string][] = [['components', '元件 3D'], ['silk', '丝印'], ['mask', '阻焊'], ['copper', '铜层透视'], ['autoRotate', '自动旋转']];
  return (
    <div className="panel-pad">
      <div className="kicker">显示</div>
      <div className="col" style={{ gap: 8 }}>
        {toggles.map(([k, label]) => <label key={k} className="row" style={{ gap: 10, cursor: 'pointer' }} onClick={() => s.set({ [k]: !s[k] } as Partial<typeof s>)}><span className={`check${s[k] ? ' on' : ''}`}>{s[k] ? '✓' : ''}</span>{label}</label>)}
      </div>
      <div className="divider" />
      <div className="kicker">工艺外观 · 随项目保存</div>
      <div className="kv">
        <span className="k">阻焊颜色</span>
        <select className="input" value={st.maskColor} onChange={(e) => set({ maskColor: e.target.value as Stackup['maskColor'] })}>{Object.keys(MASK_COLORS).map((c) => <option key={c}>{c}</option>)}</select>
        <span className="k">丝印颜色</span>
        <select className="input" value={st.silkColor} onChange={(e) => set({ silkColor: e.target.value as Stackup['silkColor'] })}>{['白', '黑', '黄'].map((c) => <option key={c}>{c}</option>)}</select>
        <span className="k">表面处理</span>
        <select className="input" value={st.finish} onChange={(e) => set({ finish: e.target.value as Stackup['finish'] })}>{FINISH.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </div>
      <div className="divider" />
      <div className="col" style={{ gap: 8 }}>
        <button className="btn" style={{ height: 30, justifyContent: 'center' }} disabled={!s.capture} onClick={() => s.capture?.()}>📷 截图 PNG</button>
        <button className="btn" style={{ height: 30, justifyContent: 'center' }} disabled={!s.exportGlb} onClick={() => void s.exportGlb?.()}>⇩ 导出 3D（GLB）</button>
        <div className="dim xs">GLB 可直接导入 Blender / Fusion 360 / KiCad 等；STEP 需要几何内核，暂不提供，可先用 GLB 或在 CAD 里把 GLB 转 STEP。</div>
        <button className="btn ghost" style={{ height: 28, justifyContent: 'center' }} onClick={() => app.go('fab')}>制造与下单参数 →</button>
      </div>
    </div>
  );
}
