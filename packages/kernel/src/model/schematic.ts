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
  type: PinTypeSchema.default('passive')
});
export type PinDef = z.infer<typeof PinDefSchema>;

export const SymbolGraphicSchema = z.enum(['box', 'resistor', 'capacitor', 'led', 'gnd', 'power']);
export type SymbolGraphic = z.infer<typeof SymbolGraphicSchema>;

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
  description: z.string().default('')
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

export const SheetSchema = z.object({
  id: z.string(),
  name: z.string(),
  components: z.array(SchComponentSchema),
  wires: z.array(WireSchema),
  labels: z.array(NetLabelSchema),
  junctions: z.array(JunctionSchema)
});
export type Sheet = z.infer<typeof SheetSchema>;

export const SchematicSchema = z.object({
  sheets: z.array(SheetSchema).min(1),
  /** 位号计数器：prefix -> 下一个可用编号 */
  counters: z.record(z.number()).default({})
});
export type Schematic = z.infer<typeof SchematicSchema>;

export function emptySchematic(): Schematic {
  return { sheets: [{ id: 'sheet_main', name: '主图', components: [], wires: [], labels: [], junctions: [] }], counters: {} };
}
