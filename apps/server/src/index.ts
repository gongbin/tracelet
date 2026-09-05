#!/usr/bin/env node
/**
 * tracelet-server：远程存储服务端。
 *   DATABASE_URL       PostgreSQL 连接串（不设则用文件存储）
 *   TRACELET_DATA_DIR  文件存储目录（默认 ./data）
 *   TRACELET_TOKEN     访问令牌（Bearer），不设则不鉴权（仅限内网）
 *   PORT               端口（默认 8787）
 *   CORS_ORIGINS       允许的来源，逗号分隔（默认 *）
 */
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { FileRepo, PgRepo } from './repo.js';

const port = Number(process.env.PORT ?? 8787);
const repo = process.env.DATABASE_URL ? await new PgRepo(process.env.DATABASE_URL).init() : await new FileRepo(process.env.TRACELET_DATA_DIR ?? './data').init();
const app = createApp(repo, { token: process.env.TRACELET_TOKEN || undefined, origins: process.env.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) });
serve({ fetch: app.fetch, port }, () => {
  console.log(`Tracelet server on http://localhost:${port}  ·  storage: ${repo.kind}${process.env.TRACELET_TOKEN ? '  ·  token required' : '  ·  no auth (LAN only!)'}`);
  console.log('Web 端：头像菜单 → 存储 → 远程，填入 http://<host>:' + port);
});
