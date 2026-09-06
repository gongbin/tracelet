import { z } from 'zod';
import { SchematicSchema, SymbolDefSchema, emptySchematic } from './schematic.js';
import { BoardSchema, FootprintDefSchema, emptyBoard } from './board.js';
import { newId } from '../ids.js';

export const FORMAT_VERSION = 1;

/** 设计规则集（对应板厂工艺能力，单位 mm）。 */
export const RuleSetSchema = z.object({
  id: z.string(),
  name: z.string(),
  minTraceWidth: z.number(),
  minClearance: z.number(),
  minDrill: z.number(),
  minAnnularRing: z.number().default(0.15),
  copperToEdge: z.number().default(0.3),
  // ---- 以下按嘉立创 / JLCPCB 工艺能力页补充（有默认值，旧工程无需迁移）----
  /** 2oz 外层铜的最小线宽 / 线距（嘉立创 0.16） */
  heavyCopperMinTrace: z.number().default(0.16),
  /** 常规过孔孔径下限：低于此值属"非常规"会加价（嘉立创 0.3 常规，0.2 可做） */
  preferredDrill: z.number().default(0.3),
  /** 插件孔（有铜）焊环：极限 / 建议（嘉立创 0.18 / 0.25） */
  minPthAnnularRing: z.number().default(0.18),
  recommendedPthAnnularRing: z.number().default(0.25),
  /** 孔边到孔边：过孔-过孔极限、含插件孔时建议（嘉立创 0.2 / 0.45） */
  minHoleToHole: z.number().default(0.2),
  recommendedPadHoleToHole: z.number().default(0.45),
  /** 插件孔孔边到异网络铜（嘉立创 0.28 极限，0.35 建议） */
  minPthHoleToCopper: z.number().default(0.28),
  /** 非金属化孔到铜（干膜掏空 0.2） */
  minNpthClearance: z.number().default(0.2),
  /** 丝印：最小字高、字符到焊盘（嘉立创 1.0 / 0.15） */
  minSilkHeight: z.number().default(1.0),
  silkToPad: z.number().default(0.15),
  /** 最小单板尺寸（嘉立创 3×3） */
  minBoardSize: z.number().default(3),
  /** 板厂常规板厚可选项（不在列表内提示可能无法下单） */
  boardThicknesses: z.array(z.number()).default([0.4, 0.6, 0.8, 1.0, 1.2, 1.6, 2.0])
});
export type RuleSet = z.infer<typeof RuleSetSchema>;

export const RULE_SETS: RuleSet[] = [
  // 嘉立创工艺能力（www.jlc.com/portal/vtechnology.html，2026-09 核对）：双面 1oz 线宽/线距极限 0.10，这里取 5mil 留余量；
  // 过孔孔径极限 0.15、常规 0.3；过孔外径 ≥ 内径 + 0.1；铜到锣边 ≥ 0.2（V 割 0.4），这里取 0.3
  { id: 'jlc', name: '嘉立创', minTraceWidth: 0.127, minClearance: 0.127, minDrill: 0.2, minAnnularRing: 0.1, copperToEdge: 0.3, heavyCopperMinTrace: 0.16, preferredDrill: 0.3, minPthAnnularRing: 0.18, recommendedPthAnnularRing: 0.25, minHoleToHole: 0.2, recommendedPadHoleToHole: 0.45, minPthHoleToCopper: 0.28, minNpthClearance: 0.2, minSilkHeight: 1.0, silkToPad: 0.15, minBoardSize: 3, boardThicknesses: [0.4, 0.6, 0.8, 1.0, 1.2, 1.6, 2.0] },
  { id: 'jlcpcb', name: 'JLCPCB', minTraceWidth: 0.127, minClearance: 0.127, minDrill: 0.2, minAnnularRing: 0.1, copperToEdge: 0.3, heavyCopperMinTrace: 0.16, preferredDrill: 0.3, minPthAnnularRing: 0.18, recommendedPthAnnularRing: 0.25, minHoleToHole: 0.2, recommendedPadHoleToHole: 0.45, minPthHoleToCopper: 0.28, minNpthClearance: 0.2, minSilkHeight: 1.0, silkToPad: 0.15, minBoardSize: 3, boardThicknesses: [0.4, 0.6, 0.8, 1.0, 1.2, 1.6, 2.0] },
  { id: 'generic', name: '通用（保守）', minTraceWidth: 0.2, minClearance: 0.2, minDrill: 0.3, minAnnularRing: 0.15, copperToEdge: 0.5, heavyCopperMinTrace: 0.2, preferredDrill: 0.3, minPthAnnularRing: 0.25, recommendedPthAnnularRing: 0.3, minHoleToHole: 0.25, recommendedPadHoleToHole: 0.5, minPthHoleToCopper: 0.35, minNpthClearance: 0.25, minSilkHeight: 1.0, silkToPad: 0.2, minBoardSize: 5, boardThicknesses: [0.8, 1.0, 1.2, 1.6, 2.0] }
];

export const ProjectSettingsSchema = z.object({
  unit: z.enum(['mm', 'mil']).default('mm'),
  ruleSetId: z.string().default('jlc'),
  fab: z.string().default('嘉立创')
});

/** 项目内库：导入的符号 / 封装随项目文件一起保存。 */
export const ProjectLibrarySchema = z.object({
  symbols: z.array(SymbolDefSchema).default([]),
  footprints: z.array(FootprintDefSchema).default([])
});
export type ProjectLibrary = z.infer<typeof ProjectLibrarySchema>;

export const ProjectSchema = z.object({
  format: z.literal('eda-project'),
  version: z.number(),
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  settings: ProjectSettingsSchema,
  schematic: SchematicSchema,
  board: BoardSchema,
  library: ProjectLibrarySchema.default({ symbols: [], footprints: [] })
});
export type Project = z.infer<typeof ProjectSchema>;
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;

export function createProject(opts: { name: string; copperCount?: 2 | 4 | 6; unit?: 'mm' | 'mil'; ruleSetId?: string; fab?: string }): Project {
  const now = new Date().toISOString();
  const board = emptyBoard();
  board.copperCount = opts.copperCount ?? 2;
  return {
    format: 'eda-project',
    version: FORMAT_VERSION,
    id: newId('prj'),
    name: opts.name,
    createdAt: now,
    updatedAt: now,
    settings: { unit: opts.unit ?? 'mm', ruleSetId: opts.ruleSetId ?? 'jlc', fab: opts.fab ?? '嘉立创' },
    schematic: emptySchematic(),
    board,
    library: { symbols: [], footprints: [] }
  };
}

export function ruleSetOf(project: Project): RuleSet {
  return RULE_SETS.find((r) => r.id === project.settings.ruleSetId) ?? RULE_SETS[0];
}
