import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCreateIndexIfNotExists, splitSqlStatements } from './sql.js';

describe('splitSqlStatements', () => {
  it('strips leading comments so the first schema statement creates departments', () => {
    const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
    const statements = splitSqlStatements(schema);
    expect(statements[0]).toMatch(/^CREATE TABLE IF NOT EXISTS departments/i);
    expect(statements.some((s) => /^CREATE TABLE IF NOT EXISTS users/i.test(s))).toBe(true);
  });

  it('ignores semicolons inside strings and comments', () => {
    const statements = splitSqlStatements(`
      -- leading comment; with a semicolon
      CREATE TABLE a (x VARCHAR(10) DEFAULT 'a;b');
      /* block; comment */
      CREATE TABLE b (y INT);
    `);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("'a;b'");
    expect(statements[1]).toMatch(/^CREATE TABLE b/i);
  });

  it('does not treat -- inside a string as a comment', () => {
    const statements = splitSqlStatements("INSERT INTO t (value) VALUES ('a--b'); SELECT 1;");
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("'a--b'");
  });
});

describe('parseCreateIndexIfNotExists', () => {
  it('parses plain and unique index statements', () => {
    expect(parseCreateIndexIfNotExists('CREATE INDEX IF NOT EXISTS idx_a ON t (a, b DESC)')).toEqual({
      unique: false,
      name: 'idx_a',
      table: 't',
      columns: 'a, b DESC',
    });
    expect(parseCreateIndexIfNotExists('CREATE UNIQUE INDEX IF NOT EXISTS idx_u ON `users` (`employee_id`)')).toEqual({
      unique: true,
      name: 'idx_u',
      table: 'users',
      columns: '`employee_id`',
    });
  });

  it('ignores ordinary CREATE INDEX statements', () => {
    expect(parseCreateIndexIfNotExists('CREATE INDEX idx_a ON t (a)')).toBeNull();
  });
});
