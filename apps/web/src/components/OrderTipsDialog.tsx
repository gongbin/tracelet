import { DEFAULT_STACKUP, boardBounds } from '@tracelet/kernel';
import { useProject } from '../store/app.js';

const PLATFORMS: { name: string; site: string; region: string; note: string }[] = [
  { name: '嘉立创', site: 'jlc.com', region: '中国大陆', note: '2 层 / 4 层小板有免费或极低价活动，3–5 天，支持 SMT 贴片与元件代购（LCSC 编号）' },
  { name: 'JLCPCB', site: 'jlcpcb.com', region: '全球（嘉立创海外）', note: '英文界面，价格与嘉立创相近，国际快递' },
  { name: '华秋 PCB', site: 'hqpcb.com', region: '中国大陆', note: '工艺选项多，阻抗 / 高层板友好' },
  { name: '捷配', site: 'jiepei.com', region: '中国大陆', note: '价格实惠，常有 5 元样板活动' },
  { name: 'PCBWay', site: 'pcbway.com', region: '全球', note: '工艺范围广（软板、铝基板、高频板），英文支持好' },
  { name: 'OSH Park', site: 'oshpark.com', region: '美国', note: '紫色板，按面积计价，适合小批量精品' },
  { name: 'Aisler', site: 'aisler.net', region: '欧洲', note: '欧洲本地生产，支持元件配单' }
];

/** 下单指引：只给参数与平台建议，不跳转任何厂商页面。 */
export function OrderTipsDialog({ close, onDownload }: { close: () => void; onDownload: () => void }) {
  const project = useProject();
  const b = project.board, st = { ...DEFAULT_STACKUP, ...(b.stackup ?? {}) }, bb = boardBounds(b);
  const params: [string, string][] = [
    ['板子尺寸', `${bb.w.toFixed(1)} × ${bb.h.toFixed(1)} mm`], ['层数', `${b.copperCount} 层`], ['板厚', `${b.thickness} mm`], ['板材', st.material],
    ['铜厚', `外层 ${st.copperWeight} oz${b.copperCount > 2 ? ` · 内层 ${st.innerCopperWeight} oz` : ''}`], ['表面处理', { HASL: '有铅喷锡', LeadFreeHASL: '无铅喷锡', ENIG: '沉金', OSP: 'OSP' }[st.finish]], ['阻焊 / 丝印', `${st.maskColor} / ${st.silkColor}`],
    ['过孔', st.viaTenting ? '盖油' : '开窗'], ['阻抗控制', st.impedance ? '需要（见 README）' : '不需要'], ['最小线宽 / 间距', `按规则集「${project.settings.fab}」`]
  ];
  return (
    <div className="overlay" onClick={close}>
      <div className="dialog" style={{ width: 680 }} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head"><div><div style={{ fontWeight: 600, fontSize: 15 }}>下单指引</div><div className="small muted" style={{ marginTop: 2 }}>把制造包上传到你选择的板厂，按下面的参数填写即可。这里不跳转任何厂商页面。</div></div><span className="ml-auto muted" style={{ cursor: 'pointer', fontSize: 16 }} onClick={close}>✕</span></div>
        <div className="dialog-body col" style={{ gap: 14 }}>
          <div>
            <div className="kicker">1 · 下单时要填的参数（已按本项目生成，也写在 zip 的 README 里）</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '4px 18px', marginTop: 6 }}>
              {params.map(([k, v]) => <div key={k} className="row" style={{ gap: 8 }}><span className="muted" style={{ width: 96, flex: 'none' }}>{k}</span><span className="mono">{v}</span></div>)}
            </div>
          </div>
          <div>
            <div className="kicker">2 · 上传什么</div>
            <div className="small" style={{ marginTop: 4, lineHeight: 1.7 }}>整个 zip（Gerber + 钻孔）。板厂会自动识别层；如需贴片再上传 BOM.csv 与 PickAndPlace.csv。下单前用「预览 Gerber」再看一眼。</div>
          </div>
          <div>
            <div className="kicker">3 · 常见平台（按需选择，价格与活动请以各平台为准）</div>
            <div className="col" style={{ gap: 4, marginTop: 6 }}>
              {PLATFORMS.map((p) => <div key={p.name} className="row" style={{ gap: 10, alignItems: 'flex-start' }}><span style={{ width: 80, flex: 'none', fontWeight: 500 }}>{p.name}</span><span className="mono xs muted" style={{ width: 96, flex: 'none' }}>{p.site}</span><span className="xs muted" style={{ width: 90, flex: 'none' }}>{p.region}</span><span className="small">{p.note}</span></div>)}
            </div>
          </div>
          <div className="dim xs">提示：第一次打板建议 2 层、1.6 mm、1 oz、喷锡，数量 5–10 片，先验证再上量；板厂反馈的 DFM 问题可以回到「检查」面板对照修改。</div>
        </div>
        <div className="dialog-foot"><button className="btn lg ghost ml-auto" onClick={close}>关闭</button><button className="btn lg primary" onClick={() => { onDownload(); close(); }}>⇩ 下载制造包 (zip)</button></div>
      </div>
    </div>
  );
}
