import type { Project } from '../model/project.js';

/** 命令：对项目的一次纯函数式修改。GUI / CLI / MCP / LLM 都通过命令修改文档。 */
export interface Command {
  /** 显示在历史记录中的名称 */
  label: string;
  apply(project: Project): Project;
}

export const command = (label: string, apply: (p: Project) => Project): Command => ({ label, apply });
