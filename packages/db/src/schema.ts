/**
 * PostgreSQL schema（Drizzle）。本地模式（PGlite）与远程模式（Postgres）共用。
 * 尚未接入运行时；先作为数据契约存在。
 */
import { pgTable, text, timestamp, jsonb, integer, uuid, boolean, index } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

export const memberships = pgTable('memberships', {
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  role: text('role', { enum: ['owner', 'editor', 'viewer'] }).notNull()
});

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id),
  ownerId: uuid('owner_id').references(() => users.id),
  name: text('name').notNull(),
  settings: jsonb('settings').notNull(),
  /** 当前项目文档（含原理图与 PCB） */
  document: jsonb('document').notNull(),
  /** Yjs 增量状态（协同） */
  yjsState: text('yjs_state'),
  isPublic: boolean('is_public').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
}, (t) => [index('projects_owner_idx').on(t.ownerId), index('projects_org_idx').on(t.orgId)]);

export const projectVersions = pgTable('project_versions', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: text('project_id').references(() => projects.id).notNull(),
  seq: integer('seq').notNull(),
  label: text('label'),
  snapshot: jsonb('snapshot').notNull(),
  authorId: uuid('author_id').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
}, (t) => [index('versions_project_idx').on(t.projectId, t.seq)]);

export const parts = pgTable('parts', {
  id: text('id').primaryKey(),
  mpn: text('mpn').notNull(),
  maker: text('maker').notNull(),
  kind: text('kind').notNull(),
  description: text('description').notNull(),
  symbol: jsonb('symbol').notNull(),
  footprint: jsonb('footprint').notNull(),
  attributes: jsonb('attributes').notNull(),
  lcsc: text('lcsc'),
  keywords: text('keywords').array().notNull().default([]),
  libId: text('lib_id').notNull(),
  license: text('license')
}, (t) => [index('parts_mpn_idx').on(t.mpn), index('parts_lib_idx').on(t.libId)]);

export const checkRuns = pgTable('check_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: text('project_id').references(() => projects.id).notNull(),
  kind: text('kind', { enum: ['erc', 'drc'] }).notNull(),
  rules: jsonb('rules').notNull(),
  report: jsonb('report').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});

export const exports = pgTable('exports', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: text('project_id').references(() => projects.id).notNull(),
  kind: text('kind').notNull(),
  objectKey: text('object_key').notNull(),
  checksum: text('checksum').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
});
