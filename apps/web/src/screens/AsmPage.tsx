import { useMemo, useState } from 'react';
import { footprintDef, type Board, type BoardFootprint } from '@tracelet/kernel';
import { useProject } from '../store/app.js';
import { getAnalysis } from '../store/analysis.js';
import { BoardView, usePanelSide, useCheckedSet, type BoardMarker, type BoardRotation } from '../components/BoardView.js';
import { useT } from '../i18n/index.js';
import type { MessageKey } from '../i18n/zh-CN.js';

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

interface AsmGroup {
  key: string;
  kind: string;
  value: string;
  footprintName: string;
  side: 'F' | 'B';
  mount: 'SMD' | 'THT';
  members: BoardFootprint[];
  hint: string;
  section: string;
  kindOrder: number;
}

const KINDS: { re: RegExp; order: number; nameKey: MessageKey; hintKey: MessageKey }[] = [
  { re: /^R/, order: 1, nameKey: 'asm.kind.R', hintKey: 'asm.hint.R' },
  { re: /^C/, order: 2, nameKey: 'asm.kind.C', hintKey: 'asm.hint.C' },
  { re: /^(D|LED)/, order: 3, nameKey: 'asm.kind.D', hintKey: 'asm.hint.D' },
  { re: /^(L|FB)/, order: 4, nameKey: 'asm.kind.L', hintKey: 'asm.hint.L' },
  { re: /^(Q|T)\d/, order: 5, nameKey: 'asm.kind.Q', hintKey: 'asm.hint.Q' },
  { re: /^U/, order: 6, nameKey: 'asm.kind.U', hintKey: 'asm.hint.U' },
  { re: /^(Y|X)\d/, order: 7, nameKey: 'asm.kind.Y', hintKey: 'asm.hint.Y' },
  { re: /^(SW|S|K)\d/, order: 8, nameKey: 'asm.kind.SW', hintKey: 'asm.hint.SW' },
  { re: /^(J|CN|P|USB)/, order: 9, nameKey: 'asm.kind.J', hintKey: 'asm.hint.J' }
];

function kindOf(ref: string) {
  return KINDS.find((k) => k.re.test(ref)) ?? { re: /$/, order: 10, nameKey: 'asm.kind.other' as MessageKey, hintKey: 'asm.hint.other' as MessageKey };
}

function buildGroups(board: Board, t: T): AsmGroup[] {
  const parts = board.footprints.filter((f) => f.componentId && footprintDef(f).pads.some((p) => !p.npth));
  const map = new Map<string, AsmGroup>();
  for (const fp of parts) {
    const def = footprintDef(fp);
    const mount: 'SMD' | 'THT' = def.pads.some((p) => p.drill > 0 && !p.npth) ? 'THT' : 'SMD';
    const kind = kindOf(fp.ref);
    const name = t(kind.nameKey);
    const key = `${mount}:${fp.side}:${kind.nameKey}:${fp.value}:${fp.footprintId}`;
    let g = map.get(key);
    if (!g) {
      const prefix = mount === 'SMD' ? t('asm.mount.smd') : t('asm.mount.tht');
      g = {
        key, kind: `${prefix}${name}`, value: fp.value, footprintName: def.name, side: fp.side, mount,
        members: [], hint: t(kind.hintKey), kindOrder: kind.order,
        section: mount === 'THT' ? t('asm.section.tht') : fp.side === 'F' ? t('asm.section.front') : t('asm.section.back')
      };
      map.set(key, g);
    }
    g.members.push(fp);
  }
  const groups = [...map.values()];
  for (const g of groups) g.members.sort((a, b) => a.y - b.y || a.x - b.x);
  const sectionOrder = (g: AsmGroup) => (g.mount === 'THT' ? 2 : g.side === 'F' ? 0 : 1);
  groups.sort((a, b) => sectionOrder(a) - sectionOrder(b) || a.kindOrder - b.kindOrder || a.value.localeCompare(b.value) || a.footprintName.localeCompare(b.footprintName));
  return groups;
}

export function AsmPage() {
  const t = useT();
  const project = useProject();
  const board = project.board;
  const analysis = getAnalysis(project);
  const [sel, setSel] = useState<string | null>(null);
  const [viewSide, setViewSide] = useState<'F' | 'B'>('F');
  const [rotation, setRotation] = useState<BoardRotation>(0);
  const [focusSeq, setFocusSeq] = useState(0);
  const [panelSide, setPanelSide] = usePanelSide();
  const [done, toggleDone, clearDone] = useCheckedSet(`tracelet:asm:${project.id}`);

  const groups = useMemo(() => buildGroups(board, t), [board, t]);
  const group = groups.find((g) => g.key === sel) ?? null;
  const sections = useMemo(() => { const m = new Map<string, AsmGroup[]>(); for (const g of groups) { const arr = m.get(g.section) ?? []; arr.push(g); m.set(g.section, arr); } return m; }, [groups]);

  const markers: BoardMarker[] = useMemo(() => {
    if (!group) return [];
    return group.members.map((fp, i) => ({ x: fp.x, y: fp.y, kind: 'badge' as const, label: String(i + 1) }));
  }, [group]);

  const pick = (g: AsmGroup) => {
    setSel(g.key === sel ? null : g.key);
    if (g.key !== sel) { setViewSide(g.side); setFocusSeq((s) => s + 1); }
  };

  if (!groups.length) {
    return <div className="page"><div className="page-inner"><h1>{t('ws.asm')}</h1><div className="muted">{t('asm.empty')}</div></div></div>;
  }

  const doneCount = groups.filter((g) => done.has(g.key)).length;
  const totalParts = groups.reduce((n, g) => n + g.members.length, 0);
  const doneParts = groups.filter((g) => done.has(g.key)).reduce((n, g) => n + g.members.length, 0);
  const nextGroup = groups.find((g) => !done.has(g.key));

  const sidebar = (
    <div className="workpage-side">
      <div className="col" style={{ gap: 10, padding: 12, borderBottom: '1px solid var(--border)' }}>
        <div className="row" style={{ gap: 8 }}>
          <span style={{ fontWeight: 600 }}>{t('asm.steps')}</span>
          <span className="dim xs">{t('asm.summary', { groups: groups.length, parts: totalParts })}</span>
          <span className="ml-auto chip" title={t('qc.panel.flip')} onClick={() => setPanelSide(panelSide === 'right' ? 'left' : 'right')}>{t(panelSide === 'right' ? 'qc.panel.right' : 'qc.panel.left')}</span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="xs mono muted">{t('asm.progress', { done: doneParts, total: totalParts })}</span>
          <span className="grow" style={{ height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
            <span style={{ display: 'block', width: `${totalParts ? (100 * doneParts) / totalParts : 0}%`, height: '100%', background: 'var(--success)' }} />
          </span>
          {doneCount > 0 && <span className="xs muted" style={{ cursor: 'pointer' }} onClick={clearDone}>{t('qc.reset')}</span>}
        </div>
        <div className="xs muted" style={{ lineHeight: 1.6 }}>{t('asm.orderHint')}</div>
        {nextGroup && !sel && <button className="btn sm primary" onClick={() => pick(nextGroup)}>{t('asm.next', { kind: nextGroup.kind, value: nextGroup.value })}</button>}
      </div>
      <div className="grow" style={{ overflow: 'auto' }}>
        {[...sections.entries()].map(([sec, gs]) => (
          <div key={sec} className="col" style={{ gap: 0 }}>
            <div className="xs dim" style={{ padding: '10px 12px 4px', letterSpacing: '.04em' }}>{sec}</div>
            {gs.map((g) => {
              const idx = groups.indexOf(g) + 1;
              const isDone = done.has(g.key);
              return (
                <div key={g.key} className={`qc-step${sel === g.key ? ' on' : ''}`} onClick={() => pick(g)}>
                  <span className={`check${isDone ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); toggleDone(g.key); }} title={isDone ? t('asm.unmark') : t('asm.mark')}>{isDone ? '✓' : ''}</span>
                  <span className="mono dim xs" style={{ width: 20, textAlign: 'right', flex: 'none' }}>{idx}</span>
                  <span className="grow nowrap" style={{ textDecoration: isDone ? 'line-through' : undefined, opacity: isDone ? 0.6 : 1 }}>
                    {g.kind}{g.value ? ` · ${g.value}` : ''}
                  </span>
                  <span className="dim xs" style={{ flex: 'none' }}>×{g.members.length}</span>
                </div>
              );
            })}
          </div>
        ))}
        <div style={{ height: 12 }} />
      </div>
      {group && (
        <div className="qc-detail col">
          <div style={{ fontWeight: 600 }}>{group.kind}{group.value ? ` · ${group.value}` : ''} <span className="dim xs">({group.footprintName} · {group.side === 'F' ? t('bv.side.front') : t('bv.side.back')})</span></div>
          <div className="xs muted" style={{ lineHeight: 1.6 }}>{t('asm.detail.marks', { n: group.members.length })}</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
            {group.members.map((fp, i) => <span key={fp.id} className="chip mono xs" title={t('asm.detail.nth', { n: i + 1 })}>{i + 1}·{fp.ref}</span>)}
          </div>
          <div className="qc-kv"><span className="qc-k">{t('asm.label.tip')}</span><span style={{ lineHeight: 1.6 }}>{group.hint}</span></div>
          {group.mount === 'THT' && <div className="qc-kv"><span className="qc-k">{t('asm.label.tool')}</span><span>{t('asm.tht.tool')}</span></div>}
          <button className={`btn sm${done.has(group.key) ? '' : ' primary'}`} onClick={() => { toggleDone(group.key); if (!done.has(group.key)) { const i = groups.indexOf(group); const nxt = groups.slice(i + 1).find((g) => !done.has(g.key)) ?? groups.find((g) => !done.has(g.key) && g !== group); if (nxt) pick(nxt); else setSel(null); } }}>
            {done.has(group.key) ? t('asm.unmarkBtn') : t('asm.markBtn')}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="workpage" style={{ flexDirection: panelSide === 'left' ? 'row-reverse' : 'row' }}>
      <div className="col grow" style={{ minWidth: 0 }}>
        <div className="subbar" style={{ gap: 10 }}>
          <span style={{ fontWeight: 600 }}>{t('asm.bar.title')}</span>
          <span className="dim xs">{t('asm.bar.note')}</span>
          <span className="ml-auto dim xs">{t('asm.bar.hint')}</span>
        </div>
        <BoardView board={board} zones={analysis.zones} side={viewSide} rotation={rotation}
          onSideChange={setViewSide} onRotationChange={setRotation}
          markers={markers} highlightFootprints={group ? group.members.map((m) => m.id) : undefined} focusSeq={focusSeq} />
      </div>
      {sidebar}
    </div>
  );
}
