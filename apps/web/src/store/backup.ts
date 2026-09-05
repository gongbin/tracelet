import { parseProject, serializeProject, zipFiles, unzipFiles, type Project } from '@tracelet/kernel';
import { useApp } from './app.js';

function download(name: string, content: string | Uint8Array, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content as BlobPart], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const slug = (s: string) => s.replace(/[^\w一-龥-]+/g, '-').replace(/^-|-$/g, '') || 'project';

/** 导出单个项目为 .eda.json。 */
export function exportProjectFile(p: Project) {
  download(`${slug(p.name)}.eda.json`, serializeProject(p), 'application/json');
}

/** 备份当前存储里的全部项目为一个 zip。 */
export async function backupAllProjects(): Promise<number> {
  const { store } = useApp.getState();
  const metas = await store.list();
  const files: { name: string; content: string; kind: 'project' }[] = [];
  for (const m of metas) { const p = await store.load(m.id); if (p) files.push({ name: `${slug(p.name)}_${p.id}.eda.json`, content: serializeProject(p), kind: 'project' }); }
  files.push({ name: 'README.txt', content: `Tracelet backup · ${new Date().toISOString()} · ${files.length} projects\n拖到 Tracelet 首页即可恢复。`, kind: 'project' });
  download(`tracelet-backup_${new Date().toISOString().slice(0, 10)}.zip`, zipFiles(files as never), 'application/zip');
  return metas.length;
}

/** 导入 .eda.json 或备份 zip；多个项目时全部保存并打开最后一个。 */
export async function importProjectFiles(files: File[]): Promise<void> {
  const app = useApp.getState();
  const projects: Project[] = [];
  const errors: string[] = [];
  for (const f of files) {
    try {
      if (f.name.toLowerCase().endsWith('.zip')) {
        const entries = unzipFiles(new Uint8Array(await f.arrayBuffer()));
        for (const e of entries) if (e.name.toLowerCase().endsWith('.json')) { try { projects.push(parseProject(e.content)); } catch (err) { errors.push(`${e.name}: ${(err as Error).message}`); } }
      } else projects.push(parseProject(await f.text()));
    } catch (err) { errors.push(`${f.name}: ${(err as Error).message}`); }
  }
  for (const p of projects) await app.store.save(p);
  await app.refreshProjects();
  if (projects.length === 1) app.openProjectObject(projects[0]);
  if (projects.length) app.toast(`已导入 ${projects.length} 个项目`, 'success');
  for (const e of errors.slice(0, 3)) app.toast(`导入失败：${e}`, 'error');
}
