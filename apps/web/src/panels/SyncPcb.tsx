import { pcb, diffBoardFromSchematic, syncBoardDetailed } from '@tracelet/kernel';
import { useApp, useEditor, useProject } from '../store/app.js';
import { useT } from '../i18n/index.js';

/** Shared project action, visible even when a component is selected. */
export function SyncPcb() {
  const project = useProject(), editor = useEditor(), app = useApp(), t = useT();
  const sync = () => {
    try {
      const d = diffBoardFromSchematic(project);
      const detail = syncBoardDetailed(project);
      editor.dispatch(pcb.syncFromSchematic());
      app.toast(`已同步到 PCB：新增 ${d.added.length}，删除 ${d.removed.length}，更新 ${d.updated.length}${detail.mapped.length ? `；${detail.mapped.length} 个 KiCad 封装已映射为内置封装` : ''}`, 'success');
      if (detail.placeholders.length) app.toast(`${detail.placeholders.length} 个元件没有可用封装，已生成占位封装（${detail.placeholders.slice(0, 4).join('、')}${detail.placeholders.length > 4 ? '…' : ''}），请在属性面板替换`);
      app.go('pcb');
    } catch (error) {
      app.toast(error instanceof Error ? error.message : String(error), 'error');
    }
  };
  return <section className="panel-pad" style={{ borderBottom: '1px solid var(--border)' }}>
    <p className="small muted" style={{ margin: '0 0 10px', lineHeight: 1.6 }}>{t('panel.syncHint')}</p>
    <button className="btn" style={{ width: '100%', justifyContent: 'center' }} onClick={sync}>{t('ws.sync')}</button>
  </section>;
}
