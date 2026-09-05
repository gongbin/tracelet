import { z } from 'zod';

export const VecSchema = z.object({ x: z.number(), y: z.number() });

/** 引脚电气类型（用于 ERC）。 */
export const PinTypeSchema = z.enum(['input', 'output', 'bidirectional', 'passive', 'power_in', 'power_out', 'open_collector', 'no_connect']);
export type PinType = z.infer<typeof PinTypeSchema>;

export const PinSideSchema = z.enum(['L', 'R', 'T', 'B']);
export type PinSide = z.infer<typeof PinSideSchema>;

/** 符号定义中的引脚（相对符号左上角，单位 mil）。 */
export const PinDefSchema = z.object({
  number: z.string(),
  name: z.string(),
  side: PinSideSchema,
  offset: z.number(),
  length: z.number().default(200),
  type: PinTypeSchema.default('passive'),
  /** 通用符号：引脚连接端点（相对符号外接框左上角，mil）；有 at 时忽略 side/offset 的几何含义 */
  at: VecSchema.optional(),
  /** 通用符号：从端点指向本体的方向（0 右 / 90 上 / 180 左 / 270 下，屏幕坐标） */
  dir: z.number().optional(),
  hidden: z.boolean().optional()
});
export type PinDef = z.infer<typeof PinDefSchema>;

export const SymbolGraphicSchema = z.enum(['box', 'resistor', 'capacitor', 'led', 'gnd', 'power', 'shapes']);
export type SymbolGraphic = z.infer<typeof SymbolGraphicSchema>;

/** 通用符号图形（相对外接框左上角，mil，y 向下）。 */
export const SymbolShapeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('polyline'), points: z.array(VecSchema).min(2), fill: z.enum(['none', 'background', 'outline']).default('none'), width: z.number().default(10) }),
  z.object({ kind: z.literal('rect'), a: VecSchema, b: VecSchema, fill: z.enum(['none', 'background', 'outline']).default('none'), width: z.number().default(10) }),
  z.object({ kind: z.literal('circle'), c: VecSchema, r: z.number(), fill: z.enum(['none', 'background', 'outline']).default('none'), width: z.number().default(10) }),
  z.object({ kind: z.literal('arc'), start: VecSchema, mid: VecSchema, end: VecSchema, width: z.number().default(10) }),
  z.object({ kind: z.literal('text'), x: z.number(), y: z.number(), text: z.string(), size: z.number().default(50) })
]);
export type SymbolShape = z.infer<typeof SymbolShapeSchema>;

/** 符号定义。 */
export const SymbolDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  prefix: z.string(),
  width: z.number(),
  height: z.number(),
  graphic: SymbolGraphicSchema,
  pins: z.array(PinDefSchema),
  showPinNames: z.boolean().default(false),
  /** 电源符号：值即为网络名，不参与 BOM。 */
  power: z.boolean().default(false),
  color: z.string().optional(),
  defaultValue: z.string().default(''),
  defaultFootprint: z.string().default(''),
  description: z.string().default(''),
  /** 通用图形（graphic === 'shapes' 时使用） */
  shapes: z.array(SymbolShapeSchema).optional(),
  /** 来源（如 KiCad 库名） */
  source: z.string().optional()
});
export type SymbolDef = z.infer<typeof SymbolDefSchema>;

/** 原理图中的元件实例。 */
export const SchComponentSchema = z.object({
  id: z.string(),
  ref: z.string(),
  symbolId: z.string(),
  value: z.string(),
  footprint: z.string().default(''),
  x: z.number(),
  y: z.number(),
  rotation: z.number().default(0),
  mirror: z.boolean().default(false),
  props: z.record(z.string()).default({})
});
export type SchComponent = z.infer<typeof SchComponentSchema>;

/** 导线：多段折线。 */
export const WireSchema = z.object({
  id: z.string(),
  points: z.array(VecSchema).min(2),
  /** 由两端引脚自动生成，元件移动时重新走线。 */
  auto: z.tuple([z.string(), z.string()]).optional()
});
export type Wire = z.infer<typeof WireSchema>;

/** 网络标签：贴在某个点上，给网络命名。 */
export const NetLabelSchema = z.object({
  id: z.string(),
  text: z.string(),
  x: z.number(),
  y: z.number()
});
export type NetLabel = z.infer<typeof NetLabelSchema>;

export const JunctionSchema = z.object({ id: z.string(), x: z.number(), y: z.number() });
export type Junction = z.infer<typeof JunctionSchema>;

/** 总线：粗线折线，本身不导电；连到总线的导线由各自标签命名。 */
export const BusSchema = z.object({ id: z.string(), points: z.array(VecSchema).min(2) });
export type Bus = z.infer<typeof BusSchema>;

/** 非电气图形：线 / 矩形 / 文字。 */
export const GraphicSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.string(), kind: z.literal('line'), points: z.array(VecSchema).min(2) }),
  z.object({ id: z.string(), kind: z.literal('rect'), a: VecSchema, b: VecSchema }),
  z.object({ id: z.string(), kind: z.literal('text'), x: z.number(), y: z.number(), text: z.string(), size: z.number().default(120) })
]);
export type Graphic = z.infer<typeof GraphicSchema>;

/** 图纸边框 / 标题栏模板。size=custom 时使用 width/height（mil）。标题栏文字均可编辑，空字符串表示使用默认（项目名 / 保存日期）。 */
export const SheetFrameSchema = z.object({
  size: z.enum(['none', 'A5', 'A4', 'A3', 'A2', 'A1', 'custom']).default('A4'),
  landscape: z.boolean().default(true),
  /** 自定义尺寸（mil），仅 size === 'custom' 时使用 */
  width: z.number().optional(),
  height: z.number().optional(),
  title: z.string().default(''),
  revision: z.string().default('1.0'),
  company: z.string().default(''),
  author: z.string().default(''),
  /** 空 = 使用项目最近保存日期 */
  date: z.string().default(''),
  comment: z.string().default(''),
  /** 标题栏宽 / 高（mil），默认 4400 × 900 */
  titleBlockWidth: z.number().optional(),
  titleBlockHeight: z.number().optional(),
  /** 标题栏标签文字（可改成英文等） */
  labels: z.object({ sheet: z.string().default('图纸'), date: z.string().default('日期'), revision: z.string().default('版本'), page: z.string().default('页'), author: z.string().default('作者') }).default({})
});
export type SheetFrame = z.infer<typeof SheetFrameSchema>;
export const TITLE_BLOCK = { w: 4400, h: 900 };
/** 实际标题栏尺寸（受页面宽度限制）。 */
export function titleBlockSize(frame: SheetFrame, pageW: number): { w: number; h: number } { return { w: Math.max(2600, Math.min(frame.titleBlockWidth ?? TITLE_BLOCK.w, pageW - 600)), h: Math.max(600, Math.min(frame.titleBlockHeight ?? TITLE_BLOCK.h, 2000)) }; }
export const DEFAULT_FRAME: SheetFrame = { size: 'A4', landscape: true, title: '', revision: '1.0', company: '', author: '', date: '', comment: '', labels: { sheet: '图纸', date: '日期', revision: '版本', page: '页', author: '作者' } };
/** 纸张尺寸（mil，横向）。 */
export const PAPER_SIZES: Record<'A5' | 'A4' | 'A3' | 'A2' | 'A1', { w: number; h: number }> = { A5: { w: 8268, h: 5827 }, A4: { w: 11693, h: 8268 }, A3: { w: 16535, h: 11693 }, A2: { w: 23386, h: 16535 }, A1: { w: 33071, h: 23386 } };
/** 当前图纸的实际页面尺寸（mil，已考虑横竖与自定义）；无边框返回 null。 */
export function paperSize(frame: SheetFrame): { w: number; h: number } | null {
  if (frame.size === 'none') return null;
  if (frame.size === 'custom') { const w = frame.width ?? PAPER_SIZES.A4.w, h = frame.height ?? PAPER_SIZES.A4.h; return { w: Math.max(2000, w), h: Math.max(2000, h) }; }
  const p = PAPER_SIZES[frame.size];
  return frame.landscape ? { w: p.w, h: p.h } : { w: p.h, h: p.w };
}

export const SheetSchema = z.object({
  id: z.string(),
  name: z.string(),
  frame: SheetFrameSchema.default(DEFAULT_FRAME),
  components: z.array(SchComponentSchema),
  wires: z.array(WireSchema),
  labels: z.array(NetLabelSchema),
  junctions: z.array(JunctionSchema),
  buses: z.array(BusSchema).default([]),
  graphics: z.array(GraphicSchema).default([])
});
export type Sheet = z.infer<typeof SheetSchema>;

export const SchematicSchema = z.object({
  sheets: z.array(SheetSchema).min(1),
  /** 位号计数器：prefix -> 下一个可用编号 */
  counters: z.record(z.number()).default({})
});
export type Schematic = z.infer<typeof SchematicSchema>;

export function emptySchematic(): Schematic {
  return { sheets: [{ id: 'sheet_main', name: '主图', frame: { ...DEFAULT_FRAME }, components: [], wires: [], labels: [], junctions: [], buses: [], graphics: [] }], counters: {} };
}
