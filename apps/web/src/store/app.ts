import { create } from 'zustand';
import { ProjectEditor, pcb, type Project, type CopperLayer, type Layer, type Vec } from '@tracelet/kernel';
import { createProjectStore, type ProjectMeta, type ProjectStore } from './projectStore.js';

export type Screen = 'home' | 'sch' | 'pcb' | '3d' | 'lib' | 'bom' | 'fab';
export type SchTool = 'select' | 'wire' | 'place' | 'pwr' | 'label' | 'bus' | 'junction' | 'draw' | 'measure';
export type PcbTool = 'select' | 'route' | 'via' | 'zone' | 'place' | 'edge' | 'text' | 'measure' | 'flip' | 'align' | 'autoroute' | 'refill';
export type RightTab = 'props' | 'layers' | 'lib' | 'check' | 'ai' | '3d';

export interface Placing { symbolId: string; value: string; footprint: string; props?: Record<string, string>; rotation: number; partLabel?: string }
export interface Routing { points: Vec[]; net: string; layer: CopperLayer; width: number; startPad?: { footprintId: string; number: string } }
export interface Toast { id: number; text: string; kind?: 'info' | 'error' | 'success' }

export interface AppState {
  store: ProjectStore;
  projects: ProjectMeta[];
  editor: ProjectEditor | null;
  screen: Screen;
  wizardOpen: boolean;
  projMenuOpen: boolean;
  paletteOpen: boolean;
  focusMode: boolean;
  bottomExpanded: boolean;
  bottomTab: 'problems' | 'nets' | 'console' | 'history';
  rightTab: RightTab | null;
  hoverTool: number;
  lastSavedAt: number | null;
  saving: boolean;
  toasts: Toast[];
  // 原理图
  schTool: SchTool;
  placing: Placing | null;
  pendingPin: { componentId: string; pin: string } | null;
  pwrMenuOpen: boolean;
  selection: string[];
  labelPrompt: Vec | null;
  cursorWorld: Vec;
  libQuery: string;
  libSelected: string | null;
  // PCB
  pcbTool: PcbTool;
  activeLayer: CopperLayer;
  pcbSelection: string[];
  routing: Routing | null;
  zoneDraft: Vec[] | null;
  measure: Vec[] | null;
  otherLayerOpacity: number;
  highlightNet: string | null;
  checkHighlight: string | null;
  flyTo: { x: number; y: number; space: 'sch' | 'pcb'; seq: number } | null;
  // 3D
  view3d: 'front' | 'back' | 'top' | 'iso';
  // 动作
  refreshProjects(): Promise<void>;
  openProject(id: string): Promise<void>;
  openProjectObject(p: Project): void;
  closeProject(): void;
  deleteProject(id: string): Promise<void>;
  go(screen: Screen): void;
  set<K extends keyof AppState>(key: K, value: AppState[K]): void;
  patch(p: Partial<AppState>): void;
  toast(text: string, kind?: Toast['kind']): void;
  dismissToast(id: number): void;
  setSchTool(t: SchTool): void;
  startPlacing(p: Placing): void;
  stopPlacing(): void;
  setPcbTool(t: PcbTool): void;
  setLayerHidden(layer: Layer, hidden: boolean): void;
}

let toastSeq = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;

export const useApp = create<AppState>((set, get) => ({
  store: createProjectStore(),
  projects: [],
  editor: null,
  screen: 'home',
  wizardOpen: false,
  projMenuOpen: false,
  paletteOpen: false,
  focusMode: false,
  bottomExpanded: false,
  bottomTab: 'problems',
  rightTab: null,
  hoverTool: -1,
  lastSavedAt: null,
  saving: false,
  toasts: [],
  schTool: 'select',
  placing: null,
  pendingPin: null,
  pwrMenuOpen: false,
  selection: [],
  labelPrompt: null,
  cursorWorld: { x: 0, y: 0 },
  libQuery: '',
  libSelected: 'part:esp32-wroom-32e',
  pcbTool: 'select',
  activeLayer: 'F.Cu',
  pcbSelection: [],
  routing: null,
  zoneDraft: null,
  measure: null,
  otherLayerOpacity: 0.4,
  highlightNet: null,
  checkHighlight: null,
  flyTo: null,
  view3d: 'iso',

  async refreshProjects() {
    try { set({ projects: await get().store.list() }); } catch (e) { get().toast(`无法读取项目列表：${(e as Error).message}`, 'error'); }
  },
  async openProject(id) {
    const p = await get().store.load(id);
    if (!p) { get().toast('项目不存在或已损坏', 'error'); return; }
    get().openProjectObject(p);
  },
  openProjectObject(p) {
    unsubscribe?.();
    const editor = new ProjectEditor(p);
    unsubscribe = editor.subscribe(() => {
      if (saveTimer) clearTimeout(saveTimer);
      set({ saving: true });
      saveTimer = setTimeout(async () => {
        try { await get().store.save(editor.project); set({ lastSavedAt: Date.now(), saving: false }); } catch (e) { set({ saving: false }); get().toast(`保存失败：${(e as Error).message}`, 'error'); }
      }, 600);
    });
    set({ editor, screen: 'sch', rightTab: null, selection: [], pcbSelection: [], placing: null, pendingPin: null, routing: null, schTool: 'select', pcbTool: 'select', lastSavedAt: Date.now(), projMenuOpen: false, wizardOpen: false, highlightNet: null, checkHighlight: null });
    void get().store.save(p).then(() => get().refreshProjects());
  },
  closeProject() {
    unsubscribe?.(); unsubscribe = null;
    set({ editor: null, screen: 'home', projMenuOpen: false });
    void get().refreshProjects();
  },
  async deleteProject(id) {
    await get().store.remove(id);
    await get().refreshProjects();
  },
  go(screen) {
    set({ screen, rightTab: null, projMenuOpen: false, hoverTool: -1, pwrMenuOpen: false, placing: null, pendingPin: null, routing: null, zoneDraft: null, measure: null, labelPrompt: null, cursorWorld: { x: 0, y: 0 } });
  },
  set(key, value) { set({ [key]: value } as Partial<AppState>); },
  patch(p) { set(p); },
  toast(text, kind = 'info') {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(() => get().dismissToast(id), 3500);
  },
  dismissToast(id) { set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })); },
  setSchTool(t) {
    const patch: Partial<AppState> = { schTool: t, pwrMenuOpen: t === 'pwr' ? !get().pwrMenuOpen : false, labelPrompt: null };
    if (t !== 'place') patch.placing = null;
    if (t !== 'wire') patch.pendingPin = null;
    if (t === 'place') patch.rightTab = 'lib';
    set(patch);
  },
  startPlacing(p) { set({ placing: p, schTool: 'place', pendingPin: null, pwrMenuOpen: false, labelPrompt: null }); },
  stopPlacing() { set({ placing: null, schTool: 'select' }); },
  setPcbTool(t) { set({ pcbTool: t, routing: null, zoneDraft: null, measure: null }); },
  setLayerHidden(layer, hidden) {
    const ed = get().editor; if (!ed) return;
    ed.dispatch(pcb.setLayerHidden(layer, hidden));
  }
}));

/** 订阅内核编辑器的项目文档。 */
import { useSyncExternalStore } from 'react';
export function useProject(): Project {
  const editor = useApp((s) => s.editor);
  if (!editor) throw new Error('没有打开的项目');
  return useSyncExternalStore(
    (cb) => editor.subscribe(cb),
    () => editor.project,
    () => editor.project
  );
}
export function useEditor(): ProjectEditor {
  const editor = useApp((s) => s.editor);
  if (!editor) throw new Error('没有打开的项目');
  return editor;
}
