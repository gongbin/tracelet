// 把内核基础零件库导出为 data/parts.json（网页「从网络更新」默认拉取仓库 main 分支的这个文件）。
// 用法：node scripts/build-parts.mjs   （需要先 pnpm install；通过 tsx 加载 TS 源码）
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(new URL('.', import.meta.url).pathname, '..');
const tmp = resolve(root, 'packages/kernel/.build-parts.tmp.ts');
writeFileSync(tmp, `import { BUILTIN_PARTS, partsToJson } from './src/index.js';\nprocess.stdout.write(partsToJson(BUILTIN_PARTS, new Date().toISOString().slice(0, 10)));\n`);
try {
  const out = execFileSync('npx', ['tsx', tmp], { cwd: resolve(root, 'packages/kernel'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  mkdirSync(resolve(root, 'data'), { recursive: true });
  writeFileSync(resolve(root, 'data/parts.json'), out);
  console.log(`data/parts.json: ${JSON.parse(out).parts.length} parts`);
} finally { try { rmSync(tmp); } catch { /* ignore */ } }
