import { parseProject, serializeProject, zipFiles, unzipFiles, importKicadProject, type Project } from '@tracelet/kernel';
import { useApp } from './app.js';

export function downloadFile(name: string, content: string | Uint8Array, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content as BlobPart], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
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
  for (const f of files) {
    try {
      const lower = f.name.toLowerCase();
      if (lower.endsWith('.zip')) {
        const entries = unzipFiles(new Uint8Array(await f.arrayBuffer()));
        for (const e of entries) {
          const el = e.name.toLowerCase();
          if (el.endsWith('.json')) { try { projects.push(parseProject(e.content)); } catch (err) { errors.push(`${e.name}: ${(err as Error).message}`); } }
          else if (el.endsWith('.kicad_sch') || el.endsWith('.kicad_pcb')) kicad.push({ name: e.name.split('/').pop()!, text: e.content });
        }
      } else if (lower.endsWith('.kicad_sch') || lower.endsWith('.kicad_pcb')) kicad.push({ name: f.name, text: await f.text() });
      else if (lower.endsWith('.kicad_pro') || lower.endsWith('.kicad_prl')) { /* 项目设置文件暂不使用 */ }
      else projects.push(parseProject(await f.text()));
    } catch (err) { errors.push(`${f.name}: ${(err as Error).message}`); }
  }
  if (kicad.length) {
    const schs = kicad.filter((k) => k.name.toLowerCase().endsWith('.kicad_sch'));
    const pcbFile = kicad.find((k) => k.name.toLowerCase().endsWith('.kicad_pcb'));
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
  for (const p of projects) await app.store.save(p);
  await app.refreshProjects();
  if (projects.length === 1) app.openProjectObject(projects[0]);
  if (projects.length) app.toast(`已导入 ${projects.length} 个项目`, 'success');
  for (const e of errors.slice(0, 3)) app.toast(`导入失败：${e}`, 'error');
}
