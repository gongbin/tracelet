/**
 * 共享布线模型：网络的线宽 / 间距 / 过孔参数只在这里推导一次，布线器、全局规划、DRC 校验都用同一份。
 */
import type { Board } from '../model/board.js';
import type { RuleSet } from '../model/project.js';
import { netClassFor } from './geometry.js';

export interface NetRules { width: number; clearance: number; viaSize: number; viaDrill: number }

export function netRules(board: Board, rules: RuleSet, net: string): NetRules {
  const nc = netClassFor(board, net);
  const viaDrill = Math.max(rules.minDrill, nc?.viaDrill ?? 0.3);
  return {
    width: Math.max(rules.minTraceWidth, nc?.traceWidth ?? 0.25),
    clearance: Math.max(rules.minClearance, nc?.clearance ?? 0),
    viaDrill,
    viaSize: Math.max(nc?.viaSize ?? 0.6, viaDrill + 2 * rules.minAnnularRing)
  };
}

/** 两个网络之间要求的铜边间距。 */
export function gapBetween(board: Board, rules: RuleSet, a: string, b: string): number {
  return Math.max(netRules(board, rules, a).clearance, netRules(board, rules, b).clearance);
}
