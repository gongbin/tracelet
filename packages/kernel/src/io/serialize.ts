import { ProjectSchema, FORMAT_VERSION, type Project } from '../model/project.js';
import { restoreLegacyBodyOffset } from '../library/legacyBodyOffsets.js';
import { registerProjectLibrary } from '../library/registry.js';

export function serializeProject(p: Project, pretty = true): string {
  return JSON.stringify(p, null, pretty ? 2 : 0);
}

/** 解析并校验 .eda.json；旧版本在此迁移。 */
export function parseProject(text: string | unknown): Project {
  const raw = typeof text === 'string' ? JSON.parse(text) : text;
  if (raw && typeof raw === 'object' && (raw as { version?: number }).version !== FORMAT_VERSION) {
    // 目前只有 v1
  }
  const result = ProjectSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new Error(`项目文件格式错误：${first.path.join('.')} ${first.message}`);
  }
  migrateFootprintBodies(result.data);
  registerProjectLibrary(result.data.library);
  return result.data;
}

/** 旧版导入的封装本体只有宽高、默认居中于原点；焊盘落在外框之外时，把外框中心挪到焊盘包围盒中心（并放大到能包住焊盘）。 */
function migrateFootprintBodies(p: Project): void {
  for (const f of p.library?.footprints ?? []) {
    restoreLegacyBodyOffset(f);
    if (f.body.x !== undefined || f.body.y !== undefined || !f.pads.length) continue;
    const x1 = Math.min(...f.pads.map((q) => q.x - q.w / 2)), x2 = Math.max(...f.pads.map((q) => q.x + q.w / 2)), y1 = Math.min(...f.pads.map((q) => q.y - q.h / 2)), y2 = Math.max(...f.pads.map((q) => q.y + q.h / 2));
    const inside = x1 >= -f.body.w / 2 - 0.3 && x2 <= f.body.w / 2 + 0.3 && y1 >= -f.body.h / 2 - 0.3 && y2 <= f.body.h / 2 + 0.3;
    if (inside) continue;
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    f.body = { w: Math.max(f.body.w, x2 - x1 + 0.2), h: Math.max(f.body.h, y2 - y1 + 0.2), x: Math.round(cx * 1000) / 1000, y: Math.round(cy * 1000) / 1000 };
  }
}
