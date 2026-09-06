import { useEffect, useMemo, useRef, useState } from 'react';
import { searchParts, allParts, pcb } from '@tracelet/kernel';
import { useApp, type Screen } from '../store/app.js';
import { getAnalysis } from '../store/analysis.js';
import { Icon } from './Icon.js';
import { I } from '../icons.js';
import { usePrefs, useT, LOCALES } from '../i18n/index.js';

interface Item { id: string; label: string; hint?: string; kind: 'cmd' | 'part' | 'net'; run: () => void }

export function CommandPalette() {
  const app = useApp();
  const prefs = usePrefs();
  const t = useT();
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (app.paletteOpen) { setQ(''); setIdx(0); setTimeout(() => inputRef.current?.focus(), 0); } }, [app.paletteOpen]);

  const items = useMemo<Item[]>(() => {
    if (!app.paletteOpen) return [];
    const ed = app.editor;
    const close = () => app.set('paletteOpen', false);
    const goto = (s: Screen) => () => { close(); app.go(s); };
    const cmds: Item[] = [];
    if (ed) {
      cmds.push(
        { id: 'go-sch', label: '打开原理图', hint: '⌘1', kind: 'cmd', run: goto('sch') },
        { id: 'go-pcb', label: '打开 PCB', hint: '⌘2', kind: 'cmd', run: goto('pcb') },
        { id: 'go-3d', label: '打开 3D 视图', hint: '⌘3', kind: 'cmd', run: goto('3d') },
        { id: 'go-fab', label: '制造与导出', kind: 'cmd', run: goto('fab') },
        { id: 'go-bom', label: '查看 BOM', kind: 'cmd', run: goto('bom') },
        { id: 'sync', label: '同步原理图到 PCB', kind: 'cmd', run: () => { close(); ed.dispatch(pcb.syncFromSchematic()); app.go('pcb'); app.toast('已同步到 PCB', 'success'); } },
        { id: 'undo', label: `撤销${ed.undoLabel ? ' · ' + ed.undoLabel : ''}`, hint: '⌘Z', kind: 'cmd', run: () => { close(); ed.undo(); } },
        { id: 'redo', label: `重做${ed.redoLabel ? ' · ' + ed.redoLabel : ''}`, hint: '⇧⌘Z', kind: 'cmd', run: () => { close(); ed.redo(); } },
        { id: 'check', label: '运行检查（ERC / DRC）', kind: 'cmd', run: () => { close(); app.set('rightTab', 'check'); const a = getAnalysis(ed.project); app.toast(`ERC ${a.erc.errors} 错误 ${a.erc.warnings} 警告 · DRC ${a.drc.errors} 错误 ${a.drc.warnings} 警告`); } },
        { id: 'focus', label: app.focusMode ? '退出焦点模式' : '焦点模式（隐藏面板）', hint: 'Tab', kind: 'cmd', run: () => { close(); app.set('focusMode', !app.focusMode); } },
        { id: 'layers-4', label: ed.project.board.copperCount === 4 ? '改为 2 层板' : '改为 4 层板', kind: 'cmd', run: () => { close(); ed.dispatch(pcb.setCopperCount(ed.project.board.copperCount === 4 ? 2 : 4)); } },
        { id: 'ai', label: '打开 AI 助手', kind: 'cmd', run: () => { close(); app.set('rightTab', 'ai'); } },
        { id: 'home', label: '关闭项目，返回首页', kind: 'cmd', run: () => { close(); app.closeProject(); } }
      );
    } else {
      cmds.push({ id: 'new', label: t('home.new'), hint: '⌘N', kind: 'cmd', run: () => { close(); app.set('wizardOpen', true); } });
    }
    cmds.push(
      { id: 'theme', label: `${t('settings.theme')}：${prefs.theme === 'dark' ? t('theme.light') : prefs.theme === 'light' ? t('theme.system') : t('theme.dark')}`, kind: 'cmd', run: () => { close(); prefs.setTheme(prefs.theme === 'dark' ? 'light' : prefs.theme === 'light' ? 'system' : 'dark'); } },
      { id: 'lang', label: `${t('settings.language')}：${LOCALES.filter((l) => l !== prefs.locale).map((l) => t(`lang.${l}` as 'lang.en')).join(' / ')}`, kind: 'cmd', run: () => { close(); prefs.setLocale(prefs.locale === 'zh-CN' ? 'en' : 'zh-CN'); } }
    );
    const parts: Item[] = (q.startsWith('@') || q.length >= 2 ? searchParts(q.replace(/^@/, ''), allParts()).slice(0, 6) : []).map((p) => ({
      id: p.id, label: p.mpn, hint: `${p.maker} · ${p.kind}`, kind: 'part' as const,
      run: () => { close(); if (!ed) return; if (app.screen !== 'sch') app.go('sch'); app.startPlacing({ symbolId: p.symbolId, value: p.value, footprint: p.footprintId, props: { mpn: p.mpn, lcsc: p.lcsc ?? '' }, rotation: 0, partLabel: p.mpn }); }
    }));
    const nets: Item[] = ed && (q.startsWith('#') || q.length >= 2) ? getAnalysis(ed.project).netlist.nets.filter((n) => n.name.toLowerCase().includes(q.replace(/^#/, '').toLowerCase())).slice(0, 6).map((n) => ({
      id: 'net:' + n.name, label: n.name, hint: `${n.pins.length} 引脚 · 高亮`, kind: 'net' as const, run: () => { close(); app.set('highlightNet', n.name); }
    })) : [];
    const ql = q.replace(/^[@#>]/, '').toLowerCase();
    const filtered = q.startsWith('@') ? [] : q.startsWith('#') ? [] : cmds.filter((c) => !ql || c.label.toLowerCase().includes(ql));
    return [...filtered, ...parts, ...nets];
  }, [q, app, prefs, t]);

  useEffect(() => { setIdx(0); }, [q]);
  if (!app.paletteOpen) return null;
  const close = () => app.set('paletteOpen', false);
  return (
    <div className="palette" onMouseDown={close}>
      <div className="palette-box" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Icon d={I.search} size={16} stroke={2} color="var(--text-2)" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('palette.placeholder')}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
              else if (e.key === 'Enter') { items[idx]?.run(); }
              else if (e.key === 'Escape') close();
            }} />
          <span className="kbd">Esc</span>
        </div>
        <div className="palette-list">
          {items.length === 0 && <div className="dim" style={{ padding: 12 }}>{t('palette.empty')}</div>}
          {items.map((it, i) => (
            <div key={it.id} className={`palette-item${i === idx ? ' on' : ''}`} onMouseEnter={() => setIdx(i)} onClick={it.run}>
              <span className="dim xs mono" style={{ width: 28 }}>{it.kind === 'cmd' ? '>' : it.kind === 'part' ? '@' : '#'}</span>
              <span className={it.kind === 'part' ? 'mono' : ''}>{it.label}</span>
              {it.hint && <span className="ml-auto dim xs mono">{it.hint}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
