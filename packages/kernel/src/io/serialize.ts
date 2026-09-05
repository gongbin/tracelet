import { ProjectSchema, FORMAT_VERSION, type Project } from '../model/project.js';

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
  return result.data;
}
