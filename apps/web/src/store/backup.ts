import { parseProject, serializeProject, zipFiles, unzipFiles, importKicadProject, importKicadPcb, importEasyEdaProject, looksLikeEasyEda, importAltiumProject, lib, type Project } from '@tracelet/kernel';
import { useApp } from './app.js';

export function downloadFile(name: string, content: string | Uint8Array, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content as BlobPart], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
/** 读文本：jsdom / 旧浏览器的 File 可能没有 text()。 */
export const readFileText = (f: File): Promise<string> => typeof f.text === 'function' ? f.text() : new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsText(f); });
export const slug = (s: string) => s.replace(/[^\w一-龥-]+/g, '-').replace(/^-|-$/g, '') || 'project';

/** 导出单个项目为 .eda.json。 */
export function exportProjectFile(p: Project) {
  downloadFile(`${slug(p.name)}.eda.json`, serializeProject(p), 'application/json');
}

/** 备份当前存储里的全部项目为一个 zip。 */
export async function backupAllProjects(): Promise<number> {
  const { store } = useApp.getState();
  const metas = await store.list();
  const files: { name: string; content: string; kind: 'project' }[] = [];
  for (const m of metas) { const p = await store.load(m.id); if (p) files.push({ name: `${slug(p.name)}_${p.id}.eda.json`, content: serializeProject(p), kind: 'project' }); }
  files.push({ name: 'README.txt', content: `Tracelet backup · ${new Date().toISOString()} · ${files.length} projects\n拖到 Tracelet 首页即可恢复。`, kind: 'project' });
  downloadFile(`tracelet-backup_${new Date().toISOString().slice(0, 10)}.zip`, zipFiles(files as never), 'application/zip');
  return metas.length;
}

/** 导入 .eda.json 或备份 zip；多个项目时全部保存并打开最后一个。 */
export async function importProjectFiles(files: File[]): Promise<void> {
  const app = useApp.getState();
  const projects: Project[] = [];
  const errors: string[] = [];
  const kicad: { name: string; text: string }[] = [];
  const easy: { name: string; text: string }[] = [];
  const altium: { name: string; data: Uint8Array }[] = [];
  const readBytes = async (f: File) => new Uint8Array(await f.arrayBuffer());
  for (const f of files) {
    try {
      const lower = f.name.toLowerCase();
      if (lower.endsWith('.zip')) {
        const entries = unzipFiles(new Uint8Array(await f.arrayBuffer()));
        for (const e of entries) {
          const el = e.name.toLowerCase();
          if (el.endsWith('.json')) { if (looksLikeEasyEda(e.content)) easy.push({ name: e.name.split('/').pop()!, text: e.content }); else { try { projects.push(parseProject(e.content)); } catch (err) { errors.push(`${e.name}: ${(err as Error).message}`); } } }
          else if (el.endsWith('.kicad_sch') || el.endsWith('.kicad_pcb')) kicad.push({ name: e.name.split('/').pop()!, text: e.content });
          else if (/\.(schdoc|pcbdoc)$/i.test(el) && e.bytes) altium.push({ name: e.name.split('/').pop()!, data: e.bytes });
        }
      } else if (lower.endsWith('.kicad_sch') || lower.endsWith('.kicad_pcb')) kicad.push({ name: f.name, text: await readFileText(f) });
      else if (/\.(schdoc|pcbdoc)$/i.test(lower)) altium.push({ name: f.name, data: await readBytes(f) });
      else if (/\.(schlib|pcblib|prjpcb|intlib)$/i.test(lower)) { if (/prjpcb$/i.test(lower)) { /* 工程文件不含设计数据 */ } else errors.push(`${f.name}: Altium 库文件（SchLib / PcbLib / IntLib）暂不支持，请导入 .SchDoc / .PcbDoc 设计文件`); }
      else if (lower.endsWith('.kicad_pro') || lower.endsWith('.kicad_prl')) { /* 项目设置文件暂不使用 */ }
      else if (lower.endsWith('.eprj') || lower.endsWith('.esch') || lower.endsWith('.epcb') || lower.endsWith('.epro')) errors.push(`${f.name}: 嘉立创 EDA 专业版文件暂不支持，请在专业版里「文件 → 导出 → 标准版 / KiCad」后导入`);
      else { const text = await readFileText(f); if (looksLikeEasyEda(text)) easy.push({ name: f.name, text }); else projects.push(parseProject(text)); }
    } catch (err) { errors.push(`${f.name}: ${(err as Error).message}`); }
  }
  if (kicad.length) {
    const schs = kicad.filter((k) => k.name.toLowerCase().endsWith('.kicad_sch'));
    const pcbFile = kicad.find((k) => k.name.toLowerCase().endsWith('.kicad_pcb'));
    // 已打开工程时只拖入 .kicad_pcb：可选择只刷新封装库（外框 / 焊盘定义），保留布局与走线
    const editor = app.editor;
    if (editor && pcbFile && !schs.length && editor.project.library.footprints.some((f) => f.id.startsWith('fp:kicad:'))) {
      const inUse = new Set(editor.project.board.footprints.map((f) => f.footprintId));
      if (confirm(`用「${pcbFile.name}」更新当前工程「${editor.project.name}」的封装库？\n\n只替换同名 KiCad 封装的外框 / 焊盘定义，保留元件位置、走线和铺铜（可 Undo）。\n点「取消」则作为新工程导入。`)) {
        try {
          const r = importKicadPcb(pcbFile.text);
          const known = new Set(editor.project.library.footprints.map((f) => f.id));
          const defs = r.footprints.filter((f) => known.has(f.id));
          if (!defs.length) { app.toast('没有找到同名封装，未做修改'); return; }
          editor.dispatch(lib.addLibraryItems({ footprints: defs }));
          app.toast(`已更新 ${defs.length} 个封装定义（其中 ${defs.filter((d) => inUse.has(d.id)).length} 个在板上使用），可 Undo`, 'success');
        } catch (err) { app.toast(`更新封装失败：${(err as Error).message}`, 'error'); }
        return;
      }
    }
    const base = (pcbFile ?? schs[0]).name.replace(/\.kicad_(sch|pcb)$/i, '');
    // 根图纸优先（与 pcb 同名的）
    schs.sort((a, b) => (a.name.startsWith(base) ? -1 : 0) - (b.name.startsWith(base) ? -1 : 0));
    try {
      const r = importKicadProject({ name: base, schematics: schs.map((s) => ({ name: s.name.replace(/\.kicad_sch$/i, ''), text: s.text })), pcb: pcbFile?.text });
      projects.push(r.project);
      const comps = r.project.schematic.sheets.reduce((n, sh) => n + sh.components.length, 0);
      app.toast(`KiCad：${schs.length} 页原理图 · ${comps} 元件${pcbFile ? ` · PCB ${r.project.board.footprints.length} 封装 / ${r.project.board.traces.length} 走线` : ' · 未选 .kicad_pcb，PCB 为空，可用「同步到 PCB」按封装名生成'}`, 'success');
      for (const w of r.warnings.slice(0, 3)) app.toast(`KiCad 导入提示 · ${w.where}: ${w.message}`);
    } catch (err) { errors.push(`KiCad: ${(err as Error).message}`); }
  }
  if (altium.length) {
    const schs = altium.filter((k) => /\.schdoc$/i.test(k.name));
    const pcbFile = altium.find((k) => /\.pcbdoc$/i.test(k.name));
    const base = (pcbFile ?? schs[0]).name.replace(/\.(schdoc|pcbdoc)$/i, '');
    try {
      const r = importAltiumProject({ name: base, schematics: schs.map((s) => ({ name: s.name.replace(/\.schdoc$/i, ''), data: s.data })), pcb: pcbFile?.data });
      projects.push(r.project);
      const comps = r.project.schematic.sheets.reduce((n, sh) => n + sh.components.length, 0);
      app.toast(`Altium：${schs.length} 页原理图 · ${comps} 元件${pcbFile ? ` · PCB ${r.project.board.footprints.length} 封装 / ${r.project.board.traces.length} 走线 / ${r.project.board.vias.length} 过孔` : ' · 未选 .PcbDoc，PCB 为空'}`, 'success');
      for (const w of r.warnings.slice(0, 3)) app.toast(`Altium 导入提示 · ${w.where}: ${w.message}`);
    } catch (err) { errors.push(`Altium: ${(err as Error).message}`); }
  }
  if (easy.length) {
    try {
      const r = importEasyEdaProject({ name: easy[0].name.replace(/\.json$/i, '').replace(/^(Schematic|PCB)[_-]?/i, '') || 'EasyEDA 导入', files: easy });
      projects.push(r.project);
      const comps = r.project.schematic.sheets.reduce((n, sh) => n + sh.components.length, 0);
      app.toast(`嘉立创 EDA：${r.project.schematic.sheets.length} 页原理图 · ${comps} 元件 · PCB ${r.project.board.footprints.length} 封装 / ${r.project.board.traces.length} 走线`, 'success');
      for (const w of r.warnings.slice(0, 3)) app.toast(`EasyEDA 导入提示 · ${w.where}: ${w.message}`);
    } catch (err) { errors.push(`EasyEDA: ${(err as Error).message}`); }
  }
  for (const p of projects) await app.store.save(p);
  await app.refreshProjects();
  if (projects.length === 1) app.openProjectObject(projects[0]);
  if (projects.length) app.toast(`已导入 ${projects.length} 个项目`, 'success');
  for (const e of errors.slice(0, 3)) app.toast(`导入失败：${e}`, 'error');
}
