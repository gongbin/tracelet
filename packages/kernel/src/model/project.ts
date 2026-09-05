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
  copperToEdge: z.number().default(0.3)
});
export type RuleSet = z.infer<typeof RuleSetSchema>;

export const RULE_SETS: RuleSet[] = [
  { id: 'jlc', name: '嘉立创', minTraceWidth: 0.127, minClearance: 0.127, minDrill: 0.3, minAnnularRing: 0.13, copperToEdge: 0.3 },
  { id: 'jlcpcb', name: 'JLCPCB', minTraceWidth: 0.127, minClearance: 0.127, minDrill: 0.3, minAnnularRing: 0.13, copperToEdge: 0.3 },
  { id: 'generic', name: '通用（保守）', minTraceWidth: 0.2, minClearance: 0.2, minDrill: 0.4, minAnnularRing: 0.15, copperToEdge: 0.5 }
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

export function createProject(opts: { name: string; copperCount?: 2 | 4; unit?: 'mm' | 'mil'; ruleSetId?: string; fab?: string }): Project {
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
