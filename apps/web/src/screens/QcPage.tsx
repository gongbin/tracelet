import { useMemo, useState } from 'react';
import { allPads, dist, type Board, type WorldPad } from '@tracelet/kernel';
import { useProject } from '../store/app.js';
import { getAnalysis } from '../store/analysis.js';
import { BoardView, usePanelSide, useCheckedSet, type BoardMarker, type BoardRotation } from '../components/BoardView.js';
import { useT } from '../i18n/index.js';
import type { MessageKey } from '../i18n/zh-CN.js';

type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

interface Probe { x: number; y: number; label: string; side: 'F' | 'B' }

interface QcFlow {
  id: string;
  group: string;
  title: string;
  goal: string;
  dial: string;
  pos: Probe;
  neg: Probe;
  steps: string[];
  expect: string;
  fail: string;
  nets: string[];
}

const POWERISH = /^(\+?\d+V\d*|VCC|VDD|VBUS|VIN|VBAT|AVCC|AVDD)$/i;
const GROUNDISH = /^(GND|AGND|DGND|VSS|PGND)$/i;

function bestPad(pads: WorldPad[]): WorldPad {
  return [...pads].sort((a, b) => Number(b.through) - Number(a.through) || b.rect.w * b.rect.h - a.rect.w * a.rect.h)[0];
}
const probeOf = (p: WorldPad, t: T): Probe => ({
  x: p.center.x, y: p.center.y,
  label: t('qc.probe.pad', { ref: p.ref, num: p.number }),
  side: p.through ? 'F' : p.layers[0] === 'B.Cu' ? 'B' : 'F'
});

function nominalVoltage(net: string): string | null {
  const m = /^\+?(\d+)V(\d+)?$/i.exec(net);
  if (!m) return null;
  return `${m[1]}${m[2] ? '.' + m[2] : ''}V`;
}

function parseOhms(v: string): number | null {
  const m = /^([\d.]+)\s*([kKmMR]?)/.exec(v.replace(/[Ωω欧]/g, ''));
  if (!m || !m[1]) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2] === 'k' || m[2] === 'K' ? n * 1e3 : m[2] === 'M' ? n * 1e6 : m[2] === 'm' ? n / 1e3 : n;
}
function ohmRange(ohms: number | null, t: T): string {
  if (ohms == null) return t('qc.ohm.auto');
  if (ohms <= 180) return t('qc.ohm.range', { range: '200Ω' });
  if (ohms <= 1800) return t('qc.ohm.range', { range: '2kΩ' });
  if (ohms <= 18000) return t('qc.ohm.range', { range: '20kΩ' });
  if (ohms <= 180000) return t('qc.ohm.range', { range: '200kΩ' });
  if (ohms <= 1.8e6) return t('qc.ohm.range', { range: '2MΩ' });
  return t('qc.ohm.range', { range: '20MΩ' });
}
function fmtOhms(ohms: number): string {
  return ohms >= 1e6 ? `${+(ohms / 1e6).toFixed(2)}MΩ` : ohms >= 1e3 ? `${+(ohms / 1e3).toFixed(2)}kΩ` : `${+ohms.toFixed(1)}Ω`;
}

function buildPreFlows(board: Board, t: T): QcFlow[] {
  const byNet = new Map<string, WorldPad[]>();
  for (const p of allPads(board)) { if (!p.net || p.def.npth) continue; const arr = byNet.get(p.net) ?? []; arr.push(p); byNet.set(p.net, arr); }
  const flows: QcFlow[] = [];
  const netOrder = (n: string) => (GROUNDISH.test(n) ? 0 : POWERISH.test(n) ? 1 : 2);
  const nets = [...byNet.keys()].sort((a, b) => netOrder(a) - netOrder(b) || a.localeCompare(b));
  const plug = t('qc.step.plug');

  for (const net of nets) {
    const pads = byNet.get(net)!;
    if (pads.length < 2) continue;
    const a = bestPad(pads);
    const b = pads.filter((p) => p !== a).reduce((best, p) => (dist(p.center, a.center) > dist(best.center, a.center) ? p : best));
    flows.push({
      id: `pre-cont-${net}`, group: t('qc.group.cont'),
      title: t('qc.cont.title', { net }),
      goal: t('qc.cont.goal', { net, a: a.ref, b: b.ref }),
      dial: t('qc.dial.beep'),
      pos: probeOf(a, t), neg: probeOf(b, t),
      steps: [plug, t('qc.cont.s1'), t('qc.cont.s2', { ref: a.ref, num: a.number }), t('qc.cont.s3', { ref: b.ref, num: b.number }), t('qc.cont.s4')],
      expect: t('qc.cont.expect'), fail: t('qc.cont.fail'), nets: [net]
    });
  }

  const powerNets = nets.filter((n) => POWERISH.test(n) && byNet.get(n)!.length >= 1);
  const gndNet = nets.find((n) => GROUNDISH.test(n));
  const pairs: [string, string][] = [];
  if (gndNet) for (const p of powerNets) pairs.push([p, gndNet]);
  for (let i = 0; i < powerNets.length; i++) for (let j = i + 1; j < powerNets.length; j++) pairs.push([powerNets[i], powerNets[j]]);
  for (const [na, nb] of pairs) {
    const a = bestPad(byNet.get(na)!), b = bestPad(byNet.get(nb)!);
    flows.push({
      id: `pre-iso-${na}-${nb}`, group: t('qc.group.iso'),
      title: t('qc.iso.title', { a: na, b: nb }),
      goal: t('qc.iso.goal', { a: na, b: nb }),
      dial: t('qc.dial.beepShort'),
      pos: probeOf(a, t), neg: probeOf(b, t),
      steps: [plug, t('qc.iso.s1', { net: na, ref: a.ref, num: a.number }), t('qc.iso.s2', { net: nb, ref: b.ref, num: b.number }), t('qc.iso.s3')],
      expect: t('qc.iso.expect'), fail: t('qc.iso.fail'), nets: [na, nb]
    });
  }
  return flows;
}

function buildPostFlows(board: Board, t: T): QcFlow[] {
  const byNet = new Map<string, WorldPad[]>();
  for (const p of allPads(board)) { if (!p.net || p.def.npth) continue; const arr = byNet.get(p.net) ?? []; arr.push(p); byNet.set(p.net, arr); }
  const flows: QcFlow[] = [];
  const gndNet = [...byNet.keys()].find((n) => GROUNDISH.test(n));
  const powerNets = [...byNet.keys()].filter((n) => POWERISH.test(n)).sort();
  const plug = t('qc.step.plug');

  if (gndNet) for (const net of powerNets) {
    const a = bestPad(byNet.get(net)!), b = bestPad(byNet.get(gndNet)!);
    flows.push({
      id: `post-short-${net}`, group: t('qc.group.short'),
      title: t('qc.short.title', { a: net, b: gndNet }),
      goal: t('qc.short.goal', { net }),
      dial: t('qc.dial.res20k'),
      pos: probeOf(a, t), neg: probeOf(b, t),
      steps: [t('qc.short.s0'), plug, t('qc.short.s1', { a: net, aref: a.ref, anum: a.number, b: gndNet, bref: b.ref, bnum: b.number }), t('qc.short.s2')],
      expect: t('qc.short.expect'), fail: t('qc.short.fail'), nets: [net, gndNet]
    });
  }

  if (gndNet) for (const net of powerNets) {
    const a = bestPad(byNet.get(net)!), b = bestPad(byNet.get(gndNet)!);
    const nominal = nominalVoltage(net);
    flows.push({
      id: `post-volt-${net}`, group: t('qc.group.volt'),
      title: t('qc.volt.title', { net }),
      goal: t('qc.volt.goal', { net }),
      dial: t('qc.dial.vdc'),
      pos: probeOf(a, t), neg: probeOf(b, t),
      steps: [t('qc.volt.s0'), plug, t('qc.volt.s1', { net, ref: a.ref, num: a.number }), t('qc.volt.s2', { net: gndNet, ref: b.ref, num: b.number })],
      expect: nominal ? t('qc.volt.expectNom', { v: nominal }) : t('qc.volt.expect'),
      fail: t('qc.volt.fail'), nets: [net, gndNet]
    });
  }

  const resistors = board.footprints.filter((f) => /^R\d+$/i.test(f.ref)).sort((x, y) => x.ref.localeCompare(y.ref, undefined, { numeric: true }));
  for (const r of resistors) {
    const pads = allPads(board).filter((p) => p.footprintId === r.id);
    if (pads.length < 2) continue;
    const [a, b] = pads;
    const ohms = parseOhms(r.value);
    flows.push({
      id: `post-res-${r.id}`, group: t('qc.group.res'),
      title: t('qc.res.title', { ref: r.ref, value: r.value || t('asm.kind.R') }),
      goal: t('qc.res.goal', { ref: r.ref }),
      dial: t('qc.dial.res', { range: ohmRange(ohms, t) }),
      pos: probeOf(a, t), neg: probeOf(b, t),
      steps: [t('qc.res.s0'), plug, t('qc.res.s1', { ref: r.ref })],
      expect: ohms != null ? t('qc.res.expectNom', { v: fmtOhms(ohms) }) : t('qc.res.expect'),
      fail: t('qc.res.fail'), nets: []
    });
  }

  const diodes = board.footprints.filter((f) => /^(D|LED)\d+$/i.test(f.ref)).sort((x, y) => x.ref.localeCompare(y.ref, undefined, { numeric: true }));
  for (const d of diodes) {
    const pads = allPads(board).filter((p) => p.footprintId === d.id);
    if (pads.length < 2) continue;
    const [a, b] = pads;
    flows.push({
      id: `post-led-${d.id}`, group: t('qc.group.led'),
      title: t('qc.led.title', { ref: d.ref, value: d.value || t('asm.kind.D') }),
      goal: t('qc.led.goal', { ref: d.ref }),
      dial: t('qc.dial.diode'),
      pos: probeOf(a, t), neg: probeOf(b, t),
      steps: [t('qc.led.s0'), plug, t('qc.led.s1', { ref: d.ref, a: a.number, b: b.number }), t('qc.led.s2')],
      expect: t('qc.led.expect'), fail: t('qc.led.fail'), nets: []
    });
  }
  return flows;
}

export function QcPage() {
  const t = useT();
  const project = useProject();
  const board = project.board;
  const analysis = getAnalysis(project);
  const [stage, setStage] = useState<'pre' | 'post'>('pre');
  const [sel, setSel] = useState<string | null>(null);
  const [viewSide, setViewSide] = useState<'F' | 'B'>('F');
  const [rotation, setRotation] = useState<BoardRotation>(0);
  const [focusSeq, setFocusSeq] = useState(0);
  const [panelSide, setPanelSide] = usePanelSide();
  const [showIntro, setShowIntro] = useState(false);
  const [done, toggleDone, clearDone] = useCheckedSet(`tracelet:qc:${project.id}:${stage}`);

  const flows = useMemo(() => (stage === 'pre' ? buildPreFlows(board, t) : buildPostFlows(board, t)), [board, stage, t]);
  const flow = flows.find((f) => f.id === sel) ?? null;
  const groups = useMemo(() => { const m = new Map<string, QcFlow[]>(); for (const f of flows) { const arr = m.get(f.group) ?? []; arr.push(f); m.set(f.group, arr); } return m; }, [flows]);

  const markers: BoardMarker[] = flow ? [
    { x: flow.pos.x, y: flow.pos.y, kind: 'pos', label: flow.pos.label },
    { x: flow.neg.x, y: flow.neg.y, kind: 'neg', label: flow.neg.label }
  ] : [];

  const pick = (f: QcFlow) => {
    setSel(f.id);
    if (f.pos.side === 'B' && f.neg.side === 'B') setViewSide('B');
    else if (f.pos.side === 'F' || f.neg.side === 'F') setViewSide('F');
    setFocusSeq((s) => s + 1);
  };

  if (!board.footprints.length) {
    return <div className="page"><div className="page-inner"><h1>{t('ws.qc')}</h1><div className="muted">{t('qc.empty')}</div></div></div>;
  }

  const doneCount = flows.filter((f) => done.has(f.id)).length;
  const sideLabel = (s: 'F' | 'B') => (s === 'B' ? t('qc.side.back') : '');

  const sidebar = (
    <div className="workpage-side">
      <div className="col" style={{ gap: 10, padding: 12, borderBottom: '1px solid var(--border)' }}>
        <div className="seg sm">
          <span className={`seg-opt${stage === 'pre' ? ' on' : ''}`} onClick={() => { setStage('pre'); setSel(null); }}>{t('qc.stage.pre')}</span>
          <span className={`seg-opt${stage === 'post' ? ' on' : ''}`} onClick={() => { setStage('post'); setSel(null); }}>{t('qc.stage.post')}</span>
        </div>
        <div className="xs muted" style={{ lineHeight: 1.6 }}>{stage === 'pre' ? t('qc.stage.preHint') : t('qc.stage.postHint')}</div>
        <div className="row" style={{ gap: 8 }}>
          <span className="xs mono muted">{t('qc.progress', { done: doneCount, total: flows.length })}</span>
          <span className="grow" style={{ height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
            <span style={{ display: 'block', width: `${flows.length ? (100 * doneCount) / flows.length : 0}%`, height: '100%', background: 'var(--success)' }} />
          </span>
          {doneCount > 0 && <span className="xs muted" style={{ cursor: 'pointer' }} onClick={clearDone}>{t('qc.reset')}</span>}
        </div>
        <div className="row xs" style={{ gap: 8 }}>
          <span className="chip" onClick={() => setShowIntro(!showIntro)}>{showIntro ? t('qc.intro.hide') : t('qc.intro.show')}</span>
          <span className="chip" title={t('qc.panel.flip')} onClick={() => setPanelSide(panelSide === 'right' ? 'left' : 'right')}>{t(panelSide === 'right' ? 'qc.panel.right' : 'qc.panel.left')}</span>
        </div>
        {showIntro && (
          <div className="xs muted col" style={{ gap: 6, lineHeight: 1.7, background: 'var(--bg-raised)', borderRadius: 6, padding: 10 }}>
            <div><b style={{ color: 'var(--text)' }}>{t('qc.intro.jacks')}</b>{t('qc.intro.jacksBody')}</div>
            <div><b style={{ color: 'var(--text)' }}>{t('qc.intro.ranges')}</b>{t('qc.intro.rangesBody')}</div>
            <div><b style={{ color: 'var(--text)' }}>{t('qc.intro.safe')}</b>{t('qc.intro.safeBody')}</div>
          </div>
        )}
      </div>
      <div className="grow" style={{ overflow: 'auto' }}>
        {[...groups.entries()].map(([g, fs]) => (
          <div key={g} className="col" style={{ gap: 0 }}>
            <div className="xs dim" style={{ padding: '10px 12px 4px', letterSpacing: '.04em' }}>{g} · {fs.length}</div>
            {fs.map((f) => (
              <div key={f.id} className={`qc-step${sel === f.id ? ' on' : ''}`} onClick={() => pick(f)}>
                <span className={`check${done.has(f.id) ? ' on' : ''}`} onClick={(e) => { e.stopPropagation(); toggleDone(f.id); }} title={done.has(f.id) ? t('qc.unmark') : t('qc.mark')}>{done.has(f.id) ? '✓' : ''}</span>
                <span className="grow nowrap" style={{ textDecoration: done.has(f.id) ? 'line-through' : undefined, opacity: done.has(f.id) ? 0.6 : 1 }}>{f.title}</span>
                <span className="dim xs">{sel === f.id ? '▾' : '▸'}</span>
              </div>
            ))}
          </div>
        ))}
        <div style={{ height: 12 }} />
      </div>
      {flow && (
        <div className="qc-detail col">
          <div style={{ fontWeight: 600 }}>{flow.title}</div>
          <div className="xs muted" style={{ lineHeight: 1.6 }}>{flow.goal}</div>
          <div className="qc-kv"><span className="qc-k">{t('qc.label.dial')}</span><span className="mono">{flow.dial}</span></div>
          <div className="qc-kv"><span className="qc-k" style={{ color: '#FF6B60' }}>{t('bv.probe.pos')}</span><span>{flow.pos.label}{sideLabel(flow.pos.side)}</span></div>
          <div className="qc-kv"><span className="qc-k">{t('bv.probe.neg')}</span><span>{flow.neg.label}{sideLabel(flow.neg.side)}</span></div>
          <ol className="qc-ol">{flow.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          <div className="qc-kv"><span className="qc-k" style={{ color: 'var(--success)' }}>{t('qc.label.expect')}</span><span>{flow.expect}</span></div>
          <div className="qc-kv"><span className="qc-k" style={{ color: 'var(--warning)' }}>{t('qc.label.fail')}</span><span>{flow.fail}</span></div>
          <button className={`btn sm${done.has(flow.id) ? '' : ' primary'}`} onClick={() => toggleDone(flow.id)}>{done.has(flow.id) ? t('qc.unmarkBtn') : t('qc.markBtn')}</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="workpage" style={{ flexDirection: panelSide === 'left' ? 'row-reverse' : 'row' }}>
      <div className="col grow" style={{ minWidth: 0 }}>
        <div className="subbar" style={{ gap: 10 }}>
          <span style={{ fontWeight: 600 }}>{t(stage === 'pre' ? 'qc.bar.pre' : 'qc.bar.post')}</span>
          <span className="dim xs">{t('qc.bar.note')}</span>
          <span className="ml-auto dim xs">{t('qc.bar.hint', { n: flows.length })}</span>
        </div>
        <BoardView board={board} zones={analysis.zones} side={viewSide} rotation={rotation}
          onSideChange={setViewSide} onRotationChange={setRotation}
          markers={markers} highlightNets={flow?.nets.length ? flow.nets : undefined} focusSeq={focusSeq} />
      </div>
      {sidebar}
    </div>
  );
}
