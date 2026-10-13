import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, pingDb, type Db } from './client.js';
import { runMigrations } from './migrate.js';

describe('db schema', () => {
  let dir: string;
  let url: string;
  let handle: Db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'localscout-db-'));
    url = join(dir, 'test.db');
    runMigrations({ url });
    handle = openDb({ url });
  });

  afterEach(() => {
    handle.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const tableNames = () =>
    handle.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);

  it('creates every table the app needs', () => {
    const tables = tableNames();
    for (const expected of ['runs', 'leads', 'audits', 'drafts', 'contact_log', 'saved_searches']) {
      expect(tables, `missing table ${expected}`).toContain(expected);
    }
  });

  it('enables foreign keys', () => {
    const result = handle.sqlite.pragma('foreign_keys', { simple: true });
    expect(result).toBe(1);
  });

  it('uses WAL for a file database', () => {
    expect(handle.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
  });

  it('reports a healthy connection', () => {
    expect(pingDb(handle.sqlite)).toBe(true);
  });

  it('is idempotent: re-running migrations does not fail', () => {
    expect(() => runMigrations({ url })).not.toThrow();
    expect(tableNames()).toContain('leads');
  });

  it('rejects a duplicate place_id', () => {
    const now = new Date();
    const insert = handle.sqlite.prepare(
      `INSERT INTO leads (id, place_id, name, status, created_at, updated_at)
       VALUES (?, ?, ?, 'discovered', ?, ?)`,
    );

    insert.run('lead_1', 'place_a', 'Sharma Plumbing', now.getTime(), now.getTime());
    expect(() => insert.run('lead_2', 'place_a', 'Copy', now.getTime(), now.getTime())).toThrow(
      /UNIQUE/,
    );
  });

  it('allows two leads to share a domain so dedupe can be reported', () => {
    const now = Date.now();
    const insert = handle.sqlite.prepare(
      `INSERT INTO leads (id, place_id, domain_key, name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'discovered', ?, ?)`,
    );

    insert.run('lead_1', 'place_a', 'example.com', 'First', now, now);
    expect(() => insert.run('lead_2', 'place_b', 'example.com', 'Second', now, now)).not.toThrow();

    const count = handle.sqlite
      .prepare('SELECT COUNT(*) AS c FROM leads WHERE domain_key = ?')
      .get('example.com') as { c: number };
    expect(count.c).toBe(2);
  });

  it('cascades deletes from a lead to its audits and drafts', () => {
    const now = Date.now();
    handle.sqlite
      .prepare(
        `INSERT INTO leads (id, place_id, name, status, created_at, updated_at)
         VALUES ('lead_1', 'place_a', 'Sharma Plumbing', 'discovered', ?, ?)`,
      )
      .run(now, now);

    handle.sqlite
      .prepare(
        `INSERT INTO audits (id, lead_id, status, started_at, duration_ms, metrics, checks, findings, opportunity_score, created_at)
         VALUES ('audit_1', 'lead_1', 'ok', ?, 100, '{}', '[]', '[]', 70, ?)`,
      )
      .run(now, now);

    handle.sqlite
      .prepare(
        `INSERT INTO drafts (id, lead_id, language, whatsapp_text, generated_by, validation_errors, created_at)
         VALUES ('draft_1', 'lead_1', 'en', 'Hello', 'llm', '[]', ?)`,
      )
      .run(now);

    handle.sqlite.prepare('DELETE FROM leads WHERE id = ?').run('lead_1');

    expect(handle.sqlite.prepare('SELECT COUNT(*) AS c FROM audits').get()).toEqual({ c: 0 });
    expect(handle.sqlite.prepare('SELECT COUNT(*) AS c FROM drafts').get()).toEqual({ c: 0 });
  });

  it('stores timestamps as integer milliseconds and enforces lead foreign keys', () => {
    const at = Date.parse('2026-10-13T10:00:00.000Z');

    expect(() =>
      handle.sqlite
        .prepare(
          `INSERT INTO contact_log (id, lead_id, channel, event, note, at)
           VALUES ('cl_orphan', 'lead_missing', 'whatsapp', 'note', 'x', ?)`,
        )
        .run(at),
    ).toThrow(/FOREIGN KEY/);

    handle.sqlite
      .prepare(
        `INSERT INTO leads (id, place_id, name, status, created_at, updated_at)
         VALUES ('lead_ts', 'place_ts', 'Time Test', 'discovered', ?, ?)`,
      )
      .run(at, at);

    handle.sqlite
      .prepare(
        `INSERT INTO contact_log (id, lead_id, channel, event, note, at)
         VALUES ('cl_ok', 'lead_ts', 'whatsapp', 'sent', 'Replied later.', ?)`,
      )
      .run(at);

    const row = handle.sqlite.prepare('SELECT at FROM contact_log WHERE id = ?').get('cl_ok') as {
      at: number;
    };
    expect(row.at).toBe(at);
  });
});
