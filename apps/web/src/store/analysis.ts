import { type Project, buildSchematicNetlist, runSchematicErc, runDrc, computeRatsnest, reviewSchematic, ruleSetOf, zoneFills, type Netlist, type CheckReport, type RatsnestResult, type ReviewSuggestion, type RuleSet, type ZoneFill } from '@tracelet/kernel';

export interface Analysis {
  netlist: Netlist;
  erc: CheckReport;
  drc: CheckReport;
  ratsnest: RatsnestResult;
  review: ReviewSuggestion[];
  rules: RuleSet;
  zones: ZoneFill[];
}

const cache = new WeakMap<Project, Analysis>();
const schCache = new WeakMap<object, { netlist: Netlist; erc: CheckReport; review: ReviewSuggestion[] }>();
const boardCache = new WeakMap<object, { drc: CheckReport; ratsnest: RatsnestResult; rules: RuleSet; zones: ZoneFill[] }>();

/** 按文档对象缓存的分析结果：网表、ERC、DRC、飞线、铺铜、审查。小板上同步计算足够快；大板后续移到 Worker。 */
export function getAnalysis(project: Project): Analysis {
  const hit = cache.get(project);
  if (hit) return hit;
  const schematic = project.schematic;
  let s = schCache.get(schematic);
  if (!s) {
    const netlist = buildSchematicNetlist(schematic);
    s = { netlist, erc: runSchematicErc(schematic, netlist), review: reviewSchematic(schematic, netlist) };
    schCache.set(schematic, s);
  }
  const rules = ruleSetOf(project);
  let b = boardCache.get(project.board);
  if (!b || b.rules.id !== rules.id) {
    b = { zones: zoneFills(project.board, rules), drc: runDrc(project.board, rules), ratsnest: computeRatsnest(project.board, rules), rules };
    boardCache.set(project.board, b);
  }
  const a: Analysis = { ...s, ...b };
  cache.set(project, a);
  return a;
}
