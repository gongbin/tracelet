import type { ReactNode } from 'react';
import { Icon } from './Icon.js';
import { I } from '../icons.js';
import { useApp } from '../store/app.js';

export interface ToolDef { id: string; name: string; key: string; d: string; desc: string; sep?: boolean }

export function Toolbar({ tools, active, onSelect, children }: { tools: ToolDef[]; active: string; onSelect: (id: string) => void; children?: ReactNode }) {
  const hover = useApp((s) => s.hoverTool);
  const set = useApp((s) => s.set);
  const hov = tools[hover];
  let top = 6;
  for (let i = 0; i < hover && i < tools.length; i++) top += 38 + (tools[i + 1]?.sep ? 9 : 0);
  return (
    <div className="toolbar" onMouseLeave={() => set('hoverTool', -1)}>
      {tools.map((t, i) => (
        <div key={t.id} style={{ display: 'contents' }}>
          {t.sep && <div className="tool-sep" />}
          <button className={`tool${t.id === active ? ' on' : ''}`} title={`${t.name}${t.key ? ' ' + t.key : ''}`} onMouseEnter={() => set('hoverTool', i)} onClick={(e) => { e.stopPropagation(); onSelect(t.id); }}>
            <Icon d={t.d} />
          </button>
        </div>
      ))}
      {hov && (
        <div className="tooltip" style={{ top }}>
          <div className="row"><b>{hov.name}</b>{hov.key && <span className="kbd ml-auto">{hov.key}</span>}</div>
          <div className="small muted" style={{ lineHeight: 1.5 }}>{hov.desc}</div>
        </div>
      )}
      {children}
      <button className="tool" style={{ marginTop: 'auto' }} title="更多工具"><Icon d={I.more} size={18} stroke={2.5} /></button>
    </div>
  );
}
