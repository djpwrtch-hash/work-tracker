export interface CreateIndexIfNotExists {
  unique: boolean;
  name: string;
  table: string;
  columns: string;
}

/**
 * Split a SQL script into individual statements while ignoring semicolons inside
 * strings, quoted identifiers and comments. MySQL drivers run with
 * `multipleStatements: false`, so every statement has to be sent separately.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let state: 'normal' | 'single' | 'double' | 'backtick' | 'lineComment' | 'blockComment' = 'normal';

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    const next = sql[i + 1];

    if (state === 'lineComment') {
      if (ch === '\n') {
        state = 'normal';
        current += '\n';
      }
      continue;
    }

    if (state === 'blockComment') {
      if (ch === '*' && next === '/') {
        state = 'normal';
        i++;
      }
      continue;
    }

    if (state === 'single' || state === 'double') {
      current += ch;
      if (ch === '\\' && i + 1 < sql.length) {
        current += sql[i + 1];
        i++;
        continue;
      }
      if ((state === 'single' && ch === "'") || (state === 'double' && ch === '"')) {
        if (next === ch) {
          current += next;
          i++;
          continue;
        }
        state = 'normal';
      }
      continue;
    }

    if (state === 'backtick') {
      current += ch;
      if (ch === '`') {
        if (next === '`') {
          current += next;
          i++;
          continue;
        }
        state = 'normal';
      }
      continue;
    }

    if (ch === '-' && next === '-' && (i + 2 >= sql.length || /\s/.test(sql[i + 2]!))) {
      state = 'lineComment';
      i++;
      continue;
    }
    if (ch === '#') {
      state = 'lineComment';
      continue;
    }
    if (ch === '/' && next === '*') {
      state = 'blockComment';
      i++;
      continue;
    }
    if (ch === "'") {
      state = 'single';
      current += ch;
      continue;
    }
    if (ch === '"') {
      state = 'double';
      current += ch;
      continue;
    }
    if (ch === '`') {
      state = 'backtick';
      current += ch;
      continue;
    }
    if (ch === ';') {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = '';
      continue;
    }
    current += ch;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

const CREATE_INDEX_IF_NOT_EXISTS = /^CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+`?([A-Za-z0-9_]+)`?\s+ON\s+`?([A-Za-z0-9_]+)`?\s*\(([\s\S]*)\)\s*$/i;

/**
 * MySQL 8 does not support `CREATE INDEX IF NOT EXISTS` (MariaDB does). Detect
 * those statements so the pool can check INFORMATION_SCHEMA first and emit a
 * plain `CREATE INDEX`.
 */
export function parseCreateIndexIfNotExists(statement: string): CreateIndexIfNotExists | null {
  const match = statement.trim().match(CREATE_INDEX_IF_NOT_EXISTS);
  if (!match) return null;
  return {
    unique: Boolean(match[1]),
    name: match[2]!,
    table: match[3]!,
    columns: match[4]!.trim(),
  };
}
