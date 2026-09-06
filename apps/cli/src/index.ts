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
  exportBomCsv, exportNetlistJson, exportPickAndPlaceCsv, exportFabFiles, exportFabZip, importKicadProject, importAltiumProject, ProjectEditor, pcb, sch, lib, diffBoardFromSchematic, getSymbol, type Project, type CheckReport,
  PROJECT_TEMPLATES, createFromTemplate, exportSchematicPdf, exportAssemblyPdf, importLibraryFile, footprintFromName, generateFootprint, importEasyEdaProject, checkPlacement, optimizePlacement, type FootprintSpec
} from '@tracelet/kernel';
import { basename } from 'node:path';
import { verifyKicad } from './kicadVerify.js';

const program = new Command();
program.name('tracelet').description('Tracelet —— 开源在线 PCB 设计工具的命令行').version('0.1.0');
program.command('verify-kicad <file>').description('验证指定 KiCad PCB（重新铺铜、DRC；不修改原文件）').option('--kicad <path>', 'KiCad CLI executable').option('--parity', '检查同目录原理图一致性').action((file,o)=>{
  try{const result=verifyKicad(file,o.kicad,!!o.parity);console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;}
  catch(e){console.error(e instanceof Error?e.message:String(e));process.exitCode=2;}
});


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

program.command('new <file>').description('创建新项目文件').option('-n, --name <name>', '项目名').option('-l, --layers <n>', '铜层数 2|4|6', '2').option('-t, --template <id>', `模板 ${PROJECT_TEMPLATES.map((t) => t.id).join('|')}`, 'blank').option('--demo', '使用 ESP32 示例内容')
  .action((file, o) => {
    if (!['2', '4', '6'].includes(o.layers)) throw new Error('Supported layers: 2, 4, 6');
    if (o.demo) { const p = createDemoProject(); p.board.copperCount = Number(o.layers) as 2 | 4 | 6; if (o.name) p.name = o.name; save(file, p); console.log(`已创建示例项目 ${file}`); return; }
    if (!PROJECT_TEMPLATES.some((t) => t.id === o.template)) { console.error(`未知模板 ${o.template}；可用：${PROJECT_TEMPLATES.map((t) => `${t.id}（${t.name}）`).join('、')}`); process.exit(1); }
    const p = createFromTemplate(o.template, { name: o.name, copperCount: o.layers === '6' ? 6 : o.layers === '4' ? 4 : 2 });
    mkdirSync(dirname(resolve(file)), { recursive: true }); save(file, p);
    console.log(`已创建 ${file}（模板 ${o.template}，${p.schematic.sheets.reduce((n, sh) => n + sh.components.length, 0)} 元件）`);
  });
program.command('templates').description('列出项目模板').option('--json').action((o) => out(PROJECT_TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description })), o.json, () => PROJECT_TEMPLATES.map((t) => `${t.id.padEnd(10)} ${t.name} — ${t.description}`).join('\n')));

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
exp.command('gerber <file>').description('Gerber + Excellon + BOM + 坐标 + 装配图（目录）').option('-o, --out <dir>', '输出目录', 'fab').action((file, o) => {
  const files = exportFabFiles(load(file), { netlist: true });
  mkdirSync(resolve(o.out), { recursive: true });
  for (const f of files) writeFileSync(resolve(o.out, f.name), f.content);
  console.log(`已写入 ${files.length} 个文件到 ${o.out}/`);
});
exp.command('pdf <file>').description('原理图 PDF（每页一张图纸）').option('-o, --out <path>').action((file, o) => { const pdf = exportSchematicPdf(load(file)); const outp = o.out ?? file.replace(/\.eda\.json$|\.json$/i, '') + '-schematic.pdf'; writeFileSync(outp, pdf, 'latin1'); console.log(`已写入 ${outp}`); });
exp.command('assembly <file>').description('装配图 PDF（顶 / 底）').option('-o, --out <path>').action((file, o) => { const pdf = exportAssemblyPdf(load(file)); const outp = o.out ?? file.replace(/\.eda\.json$|\.json$/i, '') + '-assembly.pdf'; writeFileSync(outp, pdf, 'latin1'); console.log(`已写入 ${outp}`); });
exp.command('zip <file>').description('打包全部制造文件为 zip').option('-o, --out <path>').action((file, o) => {
  const z = exportFabZip(load(file), { netlist: true, project: true });
  const out = o.out ?? z.name;
  writeFileSync(resolve(out), z.data);
  console.log(`已写入 ${out}（${(z.data.length / 1024).toFixed(1)} KB）`);
});

const imp = program.command('import').description('导入其他格式');
imp.command('altium <files...>').description('导入 Altium Designer 工程（.SchDoc 可多个 = 多页，.PcbDoc 一个）').option('-o, --out <file>', '输出 .eda.json').option('-n, --name <name>').action((files: string[], o) => {
  const schs = files.filter((f) => /\.schdoc$/i.test(f)).map((f) => ({ name: basename(f).replace(/\.schdoc$/i, ''), data: new Uint8Array(readFileSync(resolve(f))) }));
  const pcbFile = files.find((f) => /\.pcbdoc$/i.test(f));
  const name = o.name ?? basename(pcbFile ?? files[0]).replace(/\.(schdoc|pcbdoc)$/i, '');
  const r = importAltiumProject({ name, schematics: schs, pcb: pcbFile ? new Uint8Array(readFileSync(resolve(pcbFile))) : undefined });
  for (const w of r.warnings) console.error(`提示 · ${w.where}: ${w.message}`);
  const out = o.out ?? `${name}.eda.json`;
  save(out, r.project);
  const comps = r.project.schematic.sheets.reduce((n, s) => n + s.components.length, 0);
  console.log(`已导入 ${schs.length} 页原理图（${comps} 元件）${pcbFile ? `、PCB（${r.project.board.footprints.length} 封装 / ${r.project.board.traces.length} 走线 / ${r.project.board.vias.length} 过孔）` : ''} → ${out}`);
});
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

imp.command('easyeda <files...>').description('导入嘉立创 EDA 标准版 JSON（原理图 / PCB / 工程导出，可多个）').option('-o, --out <file>', '输出 .eda.json').option('-n, --name <name>').action((files: string[], o) => {
  const r = importEasyEdaProject({ name: o.name ?? basename(files[0]).replace(/\.json$/i, ''), files: files.map((f) => ({ name: basename(f), text: readFileSync(resolve(f), 'utf8') })) });
  for (const w of r.warnings) console.warn(`提示 ${w.where}: ${w.message}`);
  const outp = o.out ?? files[0].replace(/\.json$/i, '') + '.eda.json'; save(outp, r.project);
  console.log(`已导入 ${r.project.schematic.sheets.length} 页 · ${r.project.schematic.sheets.reduce((n, sh) => n + sh.components.length, 0)} 元件 · PCB ${r.project.board.footprints.length} 封装 → ${outp}`);
});
imp.command('lib <project> <files...>').description('把 KiCad 库文件（.kicad_sym / .kicad_mod）导入项目库').action((project: string, files: string[]) => {
  const ed = new ProjectEditor(load(project));
  const symbols = [] as ReturnType<typeof importLibraryFile>['symbols'], footprints = [] as ReturnType<typeof importLibraryFile>['footprints'];
  for (const f of files) { const r = importLibraryFile(basename(f), readFileSync(resolve(f), 'utf8')); symbols.push(...r.symbols); footprints.push(...r.footprints); for (const w of r.warnings) console.warn(w); }
  ed.dispatch(lib.addLibraryItems({ symbols, footprints })); save(project, ed.project);
  console.log(`已导入 ${symbols.length} 符号 · ${footprints.length} 封装 → ${project}`);
});
const plc = program.command('placement').description('布局检查与优化');
plc.command('check <file>').description('布局问题清单（重叠 / 出板 / 间距 / 去耦 / 晶振 / 连接器 / 干扰 / 长飞线 / 对齐）').option('--json').action((file, o) => { const p = load(file); const issues = checkPlacement(p.board, ruleSetOf(p)); out(issues, o.json, () => issues.length ? issues.map((i) => `  ${i.severity === 'error' ? '●' : i.severity === 'warning' ? '⚠' : '·'} [${i.rule}] ${i.message}${i.suggestion ? '  → ' + i.suggestion : ''}`).join('\n') : '布局没有发现问题'); if (issues.some((i) => i.severity === 'error')) process.exitCode = 1; });
plc.command('optimize <file>').description('模拟退火整理布局并用自动布线验证，变好才写回').option('-t, --time <ms>', '优化时间预算', '3000').option('--no-verify', '不做布线验证').option('--dry-run', '只显示建议').action((file, o) => {
  const p = load(file); const r = optimizePlacement(p.board, ruleSetOf(p), { timeBudgetMs: Number(o.time), verifyRouting: o.verify !== false, onProgress: (st) => console.error(st) });
  console.log(`飞线 HPWL ${r.before.hpwl} → ${r.after.hpwl} · 去耦平均 ${r.before.decouplingAvg} → ${r.after.decouplingAvg} mm · 问题 ${r.before.issues} → ${r.after.issues}${r.routing ? ` · 布线 ${r.routing.before.routed}/${r.routing.before.total} → ${r.routing.after.routed}/${r.routing.after.total}` : ''}`);
  if (r.rejected) { console.log(r.rejected); return; }
  for (const m of r.moves) console.log(`  ${m.ref}: (${m.from.x}, ${m.from.y}) → (${m.x}, ${m.y})${m.rotation !== undefined ? ` 旋转 ${m.rotation}°` : ''}`);
  if (!o.dryRun && r.moves.length) { const ed = new ProjectEditor(p); ed.dispatch(pcb.applyPlacementMoves(r.moves)); save(file, ed.project); console.log(`已应用 ${r.moves.length} 个移动 → ${file}`); }
});
const fpc = program.command('footprint').description('参数化封装');
fpc.command('gen <project> <spec>').description('按 KiCad 风格名（如 LQFP-48_7x7mm_P0.5mm）或 JSON spec 生成并加入项目库').action((project: string, spec: string) => {
  const ed = new ProjectEditor(load(project));
  const def = spec.trim().startsWith('{') ? generateFootprint(JSON.parse(spec) as FootprintSpec) : footprintFromName(spec);
  if (!def) { console.error('无法识别的封装名；示例：R_0603_1608Metric、SOIC-8_3.9x4.9mm_P1.27mm、LQFP-48_7x7mm_P0.5mm、QFN-32-1EP_5x5mm_P0.5mm、DIP-8_W7.62mm、PinHeader_1x04_P2.54mm_Vertical、SOT-23-5'); process.exit(1); }
  ed.dispatch(lib.addLibraryItems({ footprints: [def] })); save(project, ed.project);
  console.log(`已加入 ${def.id}（${def.pads.length} 焊盘）`);
});
program.command('serve').description('以 MCP server（stdio）模式启动，供 Claude Code / Claude Desktop 调用').option('--mcp', 'MCP stdio 模式').option('-f, --file <file>', '启动时打开的项目').option('--live', '同时开启浏览器实时桥（网页端 头像菜单 → 本地 Agent 连接后，直接操作浏览器里打开的项目）').option('--port <n>', '实时桥端口', '8790').action(async (o) => {
  const { serveMcp } = await import('./mcp.js');
  await serveMcp(o.file, o.live ? { live: { port: Number(o.port) } } : {});
});

program.parse();
