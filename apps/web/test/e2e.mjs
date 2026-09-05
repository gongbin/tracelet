// 端到端截图与控制台错误检查：node test/e2e.mjs [baseUrl]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5173';
const outDir = process.env.SHOT_DIR ?? 'test/screenshots';
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
await page.addInitScript(() => { if (!localStorage.getItem('tracelet:locale')) localStorage.setItem('tracelet:locale', 'zh-CN'); });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForSelector('text=ESP32 传感器板');
await page.screenshot({ path: `${outDir}/01-home.png` });

await page.click('text=ESP32 传感器板');
await page.waitForSelector('text=同步到 PCB');
await page.waitForTimeout(400);
await page.screenshot({ path: `${outDir}/02-schematic.png` });

// 放一个电阻并连线：R → 点击画布 → Esc
await page.keyboard.press('r');
await page.mouse.move(700, 600); await page.mouse.click(700, 600);
await page.keyboard.press('Escape');
await page.screenshot({ path: `${outDir}/03-schematic-placed.png` });

await page.click('button:has-text("元件库")');
await page.waitForTimeout(200);
await page.screenshot({ path: `${outDir}/04-library.png` });
await page.click('button:has-text("检查")');
await page.screenshot({ path: `${outDir}/05-check.png` });
await page.click('button:has-text("AI")');
await page.click('text=帮我检查电源部分有没有问题');
await page.waitForTimeout(200);
await page.screenshot({ path: `${outDir}/06-ai.png` });

await page.click('.ws-tab:has-text("PCB")');
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/07-pcb.png` });
await page.click('button:has-text("检查")');
await page.click('text=定位');
await page.waitForTimeout(300);
await page.screenshot({ path: `${outDir}/08-pcb-drc.png` });

await page.click('.ws-tab:has-text("3D")');
await page.waitForTimeout(300);
await page.screenshot({ path: `${outDir}/09-3d.png` });
await page.click('.ws-tab:has-text("制造")');
await page.screenshot({ path: `${outDir}/10-fab.png` });
await page.click('button:has-text("预览 Gerber")');
await page.waitForSelector('text=Gerber 预览');
await page.waitForTimeout(400);
await page.screenshot({ path: `${outDir}/10b-gerber-preview.png` });
await page.keyboard.press('Escape');
await page.click('.dialog-head span.muted');
await page.click('.ws-tab:has-text("库")');
await page.waitForTimeout(300);
await page.click('.cat-card:has-text("电容")');
await page.screenshot({ path: `${outDir}/10c-library-categories.png` });
await page.click('.ws-tab:has-text("制造")');
const [download] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("zip")')]);
const zipName = download.suggestedFilename();
if (!zipName.endsWith('.zip')) errors.push('zip 下载文件名异常: ' + zipName);
await page.click('.ws-tab:has-text("BOM")');
await page.screenshot({ path: `${outDir}/11-bom.png` });
await page.keyboard.press('Meta+k');
await page.waitForTimeout(200);
await page.keyboard.type('@esp');
await page.waitForTimeout(200);
await page.screenshot({ path: `${outDir}/12-palette.png` });
await page.keyboard.press('Escape');
// 浅色主题 + 英文
await page.evaluate(() => { localStorage.setItem('tracelet:theme', 'light'); localStorage.setItem('tracelet:locale', 'en'); });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('text=Projects');
await page.screenshot({ path: `${outDir}/13a-light-en-home.png` });
await page.click('text=ESP32 传感器板');
await page.waitForSelector('text=Schematic');
await page.waitForTimeout(400);
await page.screenshot({ path: `${outDir}/13-light-en-schematic.png` });
await page.click('.ws-tab:has-text("PCB")');
await page.waitForTimeout(400);
await page.screenshot({ path: `${outDir}/14-light-en-pcb.png` });
await page.evaluate(() => { localStorage.removeItem('tracelet:theme'); localStorage.removeItem('tracelet:locale'); });

await browser.close();
if (errors.length) { console.error('控制台错误：\n' + errors.join('\n')); process.exit(1); }
console.log(`OK · 截图已保存到 ${outDir}`);
