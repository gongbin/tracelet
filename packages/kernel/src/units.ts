/**
 * 单位约定
 * - 原理图坐标：mil（1/1000 英寸）。默认栅格 100 mil = 2.54 mm。
 * - PCB 坐标：mm。默认栅格 0.25 mm。
 */
export const MIL_PER_MM = 1000 / 25.4;
export const MM_PER_MIL = 25.4 / 1000;

export const SCH_GRID = 100; // mil
export const PCB_GRID = 0.25; // mm

export type Unit = 'mm' | 'mil';

export const milToMm = (v: number) => v * MM_PER_MIL;
export const mmToMil = (v: number) => v * MIL_PER_MM;

export function snapTo(v: number, grid: number): number {
  return Math.round(v / grid) * grid;
}

export function formatLength(valueMm: number, unit: Unit, digits = 2): string {
  if (unit === 'mil') return `${Math.round(mmToMil(valueMm))}`;
  return valueMm.toFixed(digits);
}
