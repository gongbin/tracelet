import type { Project } from './model/project.js';
import type { Command } from './commands/types.js';

export interface HistoryEntry { label: string; before: Project; after: Project; at: number }

export type EditorListener = () => void;

/**
 * 编辑器：持有项目文档 + 撤销/重做历史，是所有壳（Web / CLI / MCP）共用的状态容器。
 * 修改只能通过 dispatch(command)。
 */
export class ProjectEditor {
  private _project: Project;
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private listeners = new Set<EditorListener>();
  private txn: { label: string; before: Project } | null = null;
  readonly maxHistory: number;

  constructor(project: Project, opts: { maxHistory?: number } = {}) {
    this._project = project;
    this.maxHistory = opts.maxHistory ?? 200;
  }

  get project(): Project { return this._project; }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  get undoLabel(): string | null { return this.past.at(-1)?.label ?? null; }
  get redoLabel(): string | null { return this.future.at(-1)?.label ?? null; }
  get historyLabels(): string[] { return this.past.map((e) => e.label); }

  subscribe(fn: EditorListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() { for (const l of this.listeners) l(); }

  private setProject(p: Project) {
    this._project = { ...p, updatedAt: new Date().toISOString() };
  }

  /** 执行命令。事务内的命令不单独入历史。 */
  dispatch(cmd: Command): void {
    const before = this._project;
    const after = cmd.apply(before);
    if (after === before) return;
    if (this.txn) { this.setProject(after); this.emit(); return; }
    this.past.push({ label: cmd.label, before, after, at: Date.now() });
    if (this.past.length > this.maxHistory) this.past.shift();
    this.future = [];
    this.setProject(after);
    this.emit();
  }

  /** 开始事务（例如拖动）：期间的所有 dispatch 合并为一条历史。 */
  begin(label: string): void {
    if (this.txn) return;
    this.txn = { label, before: this._project };
  }

  /** 结束事务并入历史；若没有变化则不记录。 */
  commit(): void {
    if (!this.txn) return;
    const { label, before } = this.txn;
    this.txn = null;
    if (before === this._project) return;
    this.past.push({ label, before, after: this._project, at: Date.now() });
    if (this.past.length > this.maxHistory) this.past.shift();
    this.future = [];
    this.emit();
  }

  /** 放弃事务，恢复到事务开始前。 */
  rollback(): void {
    if (!this.txn) return;
    const { before } = this.txn;
    this.txn = null;
    this._project = before;
    this.emit();
  }

  undo(): boolean {
    const e = this.past.pop();
    if (!e) return false;
    this.future.push(e);
    this._project = e.before;
    this.emit();
    return true;
  }

  redo(): boolean {
    const e = this.future.pop();
    if (!e) return false;
    this.past.push(e);
    this._project = e.after;
    this.emit();
    return true;
  }

  /** 整体替换文档（加载文件），清空历史。 */
  replace(project: Project): void {
    this._project = project;
    this.past = [];
    this.future = [];
    this.txn = null;
    this.emit();
  }
}
