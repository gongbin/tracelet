#!/usr/bin/env node
/**
 * tracelet CLI —— 与 Web 编辑器共用同一个无头内核。
 * 用法见 `tracelet --help`。所有输出支持 --json，方便 CI 与 Agent 调用。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { Command } from 'commander';
import {
  parseProject, serializeProject, createProject, createDemoProject, buildNetlist, runErc, runDrc, computeRatsnest, reviewSchematic, ruleSetOf, RULE_SETS,
  exportBomCsv, exportNetlistJson, exportPickAndPlaceCsv, exportFabFiles, exportFabZip, importKicadProject, ProjectEditor, pcb, sch, diffBoardFromSchematic, getSymbol, type Project, type CheckReport
} from '@tracelet/kernel';
import { basename } from 'node:path';

const program = new Command();
program.name('tracelet').description('Tracelet —— 开源在线 PCB 设计工具的命令行').version('0.1.0');

function load(file: string): Project {
  return parseProject(readFileSync(resolve(file), 'utf8'));
}
function save(file: string, p: Project) {
  writeFileSync(resolve(file), serializeProject(p));
}
function out(data: unknown, json: boolean, text: () => string) {
  console.log(json ? JSON.stringify(data, null, 2) : text());
}
function reportText(rep: CheckReport, title: string): string {
  const lines = [`${title}: ${rep.errors} 错误, ${rep.warnings} 警告`];
  for (const i of rep.items) lines.push(`  ${i.severity === 'error' ? '●' : '⚠'} [${i.rule}] ${i.message}  (${i.refs.join(' · ')})`);
  return lines.join('\n');
}

program.command('new <file>').description('创建新项目文件').option('-n, --name <name>', '项目名', '未命名项目').option('-l, --layers <n>', '铜层数 2|4', '2').option('--demo', '使用 ESP32 示例内容')
  .action((file, o) => {
    const p = o.demo ? createDemoProject() : createProject({ name: o.name, copperCount: Number(o.layers) === 4 ? 4 : 2 });
    save(file, o.demo ? { ...p, name: o.name === '未命名项目' ? p.name : o.name } : p);
    console.log(`已创建 ${file}`);
  });

program.command('info <file>').description('项目概览').option('--json', 'JSON 输出').action((file, o) => {
  const p = load(file); const sheet = p.schematic.sheets[0]; const nl = buildNetlist(sheet); const rats = computeRatsnest(p.board);
  const data = { name: p.name, id: p.id, updatedAt: p.updatedAt, unit: p.settings.unit, rules: ruleSetOf(p).name, components: sheet.components.filter((c) => !getSymbol(c.symbolId).power).length, wires: sheet.wires.length, nets: nl.nets.length, footprints: p.board.footprints.length, traces: p.board.traces.length, copperCount: p.board.copperCount, unrouted: `${rats.unrouted}/${rats.total}` };
  out(data, o.json, () => Object.entries(data).map(([k, v]) => `${k.padEnd(12)} ${v}`).join('\n'));
});

program.command('erc <file>').description('电气规则检查').option('--json').option('--strict', '有警告也返回非零').action((file, o) => {
  const rep = runErc(load(file).schematic.sheets[0]);
  out(rep, o.json, () => reportText(rep, 'ERC'));
  process.exitCode = rep.errors > 0 || (o.strict && rep.warnings > 0) ? 1 : 0;
});

program.command('drc <file>').description('设计规则检查').option('--json').option('-r, --rules <id>', `规则集 ${RULE_SETS.map((r) => r.id).join('|')}`).option('--strict').action((file, o) => {
  const p = load(file); const rules = (o.rules && RULE_SETS.find((r) => r.id === o.rules)) || ruleSetOf(p);
  const rep = runDrc(p.board, rules);
  out({ rules: rules.id, ...rep }, o.json, () => reportText(rep, `DRC (${rules.name})`));
  process.exitCode = rep.errors > 0 || (o.strict && rep.warnings > 0) ? 1 : 0;
});

program.command('review <file>').description('确定性设计审查（去耦、上拉、限流）').option('--json').action((file, o) => {
  const r = reviewSchematic(load(file).schematic.sheets[0]);
  out(r, o.json, () => (r.length ? r.map((s) => `  ${s.severity === 'warning' ? '⚠' : 'ℹ'} ${s.title}\n     ${s.detail}`).join('\n') : '没有发现常见问题'));
});

program.command('netlist <file>').description('输出网表').option('--json').action((file, o) => {
  const nl = exportNetlistJson(load(file));
  out(nl, o.json || true, () => JSON.stringify(nl, null, 2));
});

program.command('sync <file>').description('原理图 → PCB 同步（写回文件）').option('--dry-run', '只显示差异').action((file, o) => {
  const p = load(file); const d = diffBoardFromSchematic(p);
  console.log(`新增 ${d.added.join(',') || '-'} · 删除 ${d.removed.join(',') || '-'} · 更新 ${d.updated.length}`);
  if (!o.dryRun) { const ed = new ProjectEditor(p); ed.dispatch(pcb.syncFromSchematic()); save(file, ed.project); console.log('已写回'); }
});

program.command('place <file> <symbol>').description('在原理图放置元件，如 sym:R').option('-x <mil>', 'X', '1000').option('-y <mil>', 'Y', '1000').option('-v, --value <v>').action((file, symbol, o) => {
  const p = load(file); const ed = new ProjectEditor(p);
  const r = sch.placeComponent(p, { sheetId: p.schematic.sheets[0].id, symbolId: symbol, center: { x: Number(o.x), y: Number(o.y) }, value: o.value });
  ed.dispatch(r.command); save(file, ed.project); console.log(`已放置 ${r.ref}`);
});

const exp = program.command('export').description('导出制造/物料文件');
exp.command('bom <file>').option('-o, --out <path>').action((file, o) => { const csv = exportBomCsv(load(file)); if (o.out) { mkdirSync(dirname(resolve(o.out)), { recursive: true }); writeFileSync(o.out, csv); console.log(`已写入 ${o.out}`); } else process.stdout.write(csv); });
exp.command('pnp <file>').description('坐标文件').option('-o, --out <path>').action((file, o) => { const csv = exportPickAndPlaceCsv(load(file)); if (o.out) { writeFileSync(o.out, csv); console.log(`已写入 ${o.out}`); } else process.stdout.write(csv); });
exp.command('netlist <file>').option('-o, --out <path>').action((file, o) => { const s = JSON.stringify(exportNetlistJson(load(file)), null, 2); if (o.out) { writeFileSync(o.out, s); console.log(`已写入 ${o.out}`); } else process.stdout.write(s + '\n'); });
exp.command('gerber <file>').description('Gerber + Excellon + BOM + 坐标（目录）').option('-o, --out <dir>', '输出目录', 'fab').action((file, o) => {
  const files = exportFabFiles(load(file), { netlist: true });
  mkdirSync(resolve(o.out), { recursive: true });
  for (const f of files) writeFileSync(resolve(o.out, f.name), f.content);
  console.log(`已写入 ${files.length} 个文件到 ${o.out}/`);
});
exp.command('zip <file>').description('打包全部制造文件为 zip').option('-o, --out <path>').action((file, o) => {
  const z = exportFabZip(load(file), { netlist: true, project: true });
  const out = o.out ?? z.name;
  writeFileSync(resolve(out), z.data);
  console.log(`已写入 ${out}（${(z.data.length / 1024).toFixed(1)} KB）`);
});

const imp = program.command('import').description('导入其他格式');
imp.command('kicad <files...>').description('导入 KiCad 工程（.kicad_sch 可多个 = 多页，.kicad_pcb 一个）').option('-o, --out <file>', '输出 .eda.json').option('-n, --name <name>').action((files: string[], o) => {
  const schs = files.filter((f) => f.endsWith('.kicad_sch')).map((f) => ({ name: basename(f, '.kicad_sch'), text: readFileSync(resolve(f), 'utf8') }));
  const pcbFile = files.find((f) => f.endsWith('.kicad_pcb'));
  const name = o.name ?? basename(pcbFile ?? files[0]).replace(/\.kicad_(sch|pcb)$/, '');
  const r = importKicadProject({ name, schematics: schs, pcb: pcbFile ? readFileSync(resolve(pcbFile), 'utf8') : undefined });
  for (const w of r.warnings) console.error(`提示 · ${w.where}: ${w.message}`);
  const out = o.out ?? `${name}.eda.json`;
  save(out, r.project);
  const comps = r.project.schematic.sheets.reduce((n, s) => n + s.components.length, 0);
  console.log(`已导入 ${schs.length} 页原理图（${comps} 元件）${pcbFile ? `、PCB（${r.project.board.footprints.length} 封装 / ${r.project.board.traces.length} 走线）` : ''} → ${out}`);
});

program.command('serve').description('以 MCP server（stdio）模式启动，供 Claude Code / Claude Desktop 调用').option('--mcp', 'MCP stdio 模式').option('-f, --file <file>', '启动时打开的项目').action(async (o) => {
  const { serveMcp } = await import('./mcp.js');
  await serveMcp(o.file);
});

program.parse();
