import { use3d, MASK_COLORS } from '../editors/three/ThreeView.js';
import { useApp } from '../store/app.js';

export function View3dPanel() {
  const s = use3d();
  const app = useApp();
  const toggles: [keyof typeof s, string][] = [['components', '元件 3D'], ['silk', '丝印'], ['mask', '阻焊'], ['copper', '铜层透视'], ['autoRotate', '自动旋转']];
  return (
    <div className="panel-pad">
      <div className="kicker">显示</div>
      <div className="col" style={{ gap: 8 }}>
        {toggles.map(([k, label]) => <label key={k} className="row" style={{ gap: 10, cursor: 'pointer' }} onClick={() => s.set({ [k]: !s[k] } as Partial<typeof s>)}><span className={`check${s[k] ? ' on' : ''}`}>{s[k] ? '✓' : ''}</span>{label}</label>)}
      </div>
      <div className="divider" />
      <div className="kv">
        <span className="k">阻焊颜色</span>
        <select className="input" value={s.maskColor} onChange={(e) => s.set({ maskColor: e.target.value })}>{Object.keys(MASK_COLORS).map((c) => <option key={c}>{c}</option>)}</select>
        <span className="k">丝印颜色</span>
        <select className="input" value={s.silkColor} onChange={(e) => s.set({ silkColor: e.target.value })}>{['白', '黑', '黄'].map((c) => <option key={c}>{c}</option>)}</select>
        <span className="k">表面处理</span>
        <select className="input" value={s.finish} onChange={(e) => s.set({ finish: e.target.value })}>{['HASL', '无铅 HASL', 'ENIG'].map((c) => <option key={c}>{c}</option>)}</select>
      </div>
      <div className="divider" />
      <div className="col" style={{ gap: 8 }}>
        <button className="btn" style={{ height: 30, justifyContent: 'center' }} onClick={() => app.toast('STEP 导出依赖 OpenCascade，下一里程碑')}>⇩ 导出 STEP</button>
        <button className="btn" style={{ height: 30, justifyContent: 'center' }} onClick={() => app.toast('截图在下一里程碑')}>截图</button>
      </div>
    </div>
  );
}
