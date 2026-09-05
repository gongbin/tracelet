import { useApp, useEditor } from '../store/app.js';

export interface ProblemRow { id: string; mark: string; color: string; text: string; where: string; onLocate?: () => void }
export interface NetRow { name: string; count: number }

export function BottomBar({ summary, problems, nets }: { summary: { text: string; color?: string }[]; problems: ProblemRow[]; nets: NetRow[] }) {
  const expanded = useApp((s) => s.bottomExpanded);
  const tab = useApp((s) => s.bottomTab);
  const set = useApp((s) => s.set);
  const editor = useEditor();
  const highlight = useApp((s) => s.highlightNet);
  return (
    <div className="bottombar">
      <div className="bottombar-head">
        {summary.map((b, i) => <span key={i} className="row" style={{ color: b.color ?? 'var(--text-2)', gap: 5, cursor: 'pointer' }} onClick={() => set('bottomExpanded', true)}>{b.text}</span>)}
        <span className="ml-auto muted" style={{ cursor: 'pointer' }} onClick={() => set('bottomExpanded', !expanded)}>{expanded ? '▾' : '▴'}</span>
      </div>
      {expanded && (
        <div className="bottombar-body">
          <div className="bottombar-nav">
            {([['problems', '问题'], ['nets', '网络'], ['console', '控制台'], ['history', '历史']] as const).map(([id, label]) => (
              <div key={id} className={tab === id ? 'on' : ''} onClick={() => set('bottomTab', id)}>{label}</div>
            ))}
          </div>
          <div className="grow" style={{ overflow: 'auto' }}>
            {tab === 'problems' && (problems.length === 0 ? <div className="dim" style={{ padding: 12 }}>没有问题 🎉</div> : problems.map((p) => (
              <div key={p.id} className="problem-row" onClick={p.onLocate}>
                <span style={{ color: p.color }}>{p.mark}</span><span>{p.text}</span><span className="muted">{p.where}</span>
                {p.onLocate && <span className="ml-auto" style={{ color: 'var(--accent)' }}>定位</span>}
              </div>
            )))}
            {tab === 'nets' && nets.map((n) => (
              <div key={n.name} className="problem-row" style={{ background: highlight === n.name ? 'var(--bg-raised)' : undefined }} onClick={() => set('highlightNet', highlight === n.name ? null : n.name)}>
                <span>{n.name}</span><span className="muted">{n.count} 引脚</span>
                <span className="ml-auto" style={{ color: 'var(--accent)' }}>{highlight === n.name ? '取消高亮' : '高亮'}</span>
              </div>
            ))}
            {tab === 'console' && <div className="mono xs" style={{ padding: 12, color: 'var(--text-2)', lineHeight: 1.7 }}>
              <div>$ tracelet erc project.eda.json</div><div>$ tracelet drc project.eda.json --rules jlc</div><div>$ tracelet export bom project.eda.json</div>
              <div className="dim">控制台与 CLI 共用内核命令；在终端里运行 <span style={{ color: 'var(--text)' }}>pnpm cli --help</span> 查看全部命令。</div>
            </div>}
            {tab === 'history' && (
              <div>
                {editor.historyLabels.length === 0 && <div className="dim" style={{ padding: 12 }}>还没有修改</div>}
                {editor.historyLabels.map((l, i) => <div key={i} className="problem-row"><span className="dim">{i + 1}</span><span>{l}</span></div>).reverse()}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
