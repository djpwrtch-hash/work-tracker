import dotenv from 'dotenv';
dotenv.config();
import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import mysql, { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { parseCreateIndexIfNotExists, splitSqlStatements } from './sql.js';

export function resolveDbConfig(): mysql.PoolOptions {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    try {
      const url = new URL(databaseUrl);
      return {
        host: url.hostname || process.env.MYSQL_HOST || 'localhost',
        port: Number(url.port) || Number(process.env.MYSQL_PORT) || 3306,
        user: decodeURIComponent(url.username) || process.env.MYSQL_USER || 'root',
        password: decodeURIComponent(url.password) || process.env.MYSQL_PASSWORD || '',
        database: url.pathname.replace(/^\//, '').split('?')[0] || process.env.MYSQL_DATABASE || 'hr',
        multipleStatements: false,
        connectionLimit: Number(process.env.MYSQL_POOL_LIMIT || '50'),
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000,
        charset: 'utf8mb4',
        timezone: '+00:00',
        dateStrings: ['DATE'],
        connectTimeout: Number(process.env.MYSQL_CONNECT_TIMEOUT_MS || '10000'),
        // Release idle connections so the server survives long idle periods / sleep
        idleTimeout: Number(process.env.MYSQL_IDLE_TIMEOUT_MS || '600000'),
        maxIdle: Number(process.env.MYSQL_MAX_IDLE || '10'),
        queueLimit: Number(process.env.MYSQL_QUEUE_LIMIT || '0'),
      };
    } catch {}
  }
  return {
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'hr',
    multipleStatements: false,
    connectionLimit: Number(process.env.MYSQL_POOL_LIMIT || '50'),
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    charset: 'utf8mb4',
    timezone: '+00:00',
    dateStrings: ['DATE'],
    connectTimeout: Number(process.env.MYSQL_CONNECT_TIMEOUT_MS || '10000'),
    // Release idle connections so the server survives long idle periods / sleep
    idleTimeout: Number(process.env.MYSQL_IDLE_TIMEOUT_MS || '600000'),
    maxIdle: Number(process.env.MYSQL_MAX_IDLE || '10'),
    queueLimit: Number(process.env.MYSQL_QUEUE_LIMIT || '0'),
  };
}

const dbConfig = resolveDbConfig();
export const mysqlPool: Pool = mysql.createPool(dbConfig);
mysqlPool.on('connection', (connection) => {
  const sqlMode = "SET sql_mode = 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'";
  const conn = connection as unknown as {
    promise?: () => { query: (sql: string) => Promise<unknown> };
    query: (sql: string, callback: () => void) => void;
  };
  if (typeof conn.promise === 'function') {
    conn.promise().query(sqlMode).catch(() => {});
  } else {
    conn.query(sqlMode, () => {});
  }
});
console.log(`[DB] MySQL: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);

export function uuid(): string { return randomUUID(); }

export const als = new AsyncLocalStorage<PoolConnection>();

export function getTarget(): Pool | PoolConnection {
  return als.getStore() ?? mysqlPool;
}

// A pooled connection can go stale (PC sleep, MySQL restart, network drop). The first
// query on such a connection fails; retry it once so callers get a working connection
// instead of a transient error. mysql2 discards the dead connection from the pool, so
// the retry lands on a fresh one. Inside a transaction there is nothing to retry.
const STALE_CONNECTION = /PROTOCOL_CONNECTION_LOST|ECONNRESET|ETIMEDOUT|EPIPE|CONNECTION_ALREADY_CLOSED|server has gone away|connection lost/i;

// mysql2 puts the machine-readable code on `error.code`; the human-readable text can
// differ between versions/platforms (e.g. "Connection lost: The server closed the
// connection."). Match against both so a dropped connection is always retried.
function isStaleConnectionError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null;
  return STALE_CONNECTION.test(`${e?.code ?? ''} ${e?.message ?? String(error)}`);
}

async function queryWithRetry(sql: string, params: any[]): Promise<[any, any]> {
  try {
    const [rows, fields] = await getTarget().query(sql, params);
    return [rows, fields];
  } catch (e: any) {
    if (als.getStore() || !isStaleConnectionError(e)) throw e;
    const [rows, fields] = await mysqlPool.query(sql, params);
    return [rows, fields];
  }
}

export const db = {
  prepare: (sql: string) => {
    return {
      get: async (...params: any[]): Promise<any> => {
        const [rows] = await queryWithRetry(sql, params);
        return (rows as RowDataPacket[])[0] ?? undefined;
      },
      all: async (...params: any[]): Promise<any[]> => {
        const [rows] = await queryWithRetry(sql, params);
        return rows as RowDataPacket[];
      },
      run: async (...params: any[]): Promise<any> => {
        const [result] = await queryWithRetry(sql, params);
        return { changes: (result as ResultSetHeader).affectedRows, lastInsertRowid: (result as ResultSetHeader).insertId };
      },
    };
  },
  exec: async (sql: string): Promise<void> => {
    const stmts = splitSqlStatements(sql);
    for (const stmt of stmts) {
      const createIndex = parseCreateIndexIfNotExists(stmt);
      if (createIndex) {
        try {
          const [rows] = await queryWithRetry(
            'SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1',
            [createIndex.table, createIndex.name],
          );
          if ((rows as RowDataPacket[]).length > 0) continue;
          await queryWithRetry(
            `CREATE ${createIndex.unique ? 'UNIQUE ' : ''}INDEX \`${createIndex.name}\` ON \`${createIndex.table}\` (${createIndex.columns})`,
            [],
          );
        } catch (e: any) {
          const msg = e.message ?? '';
          if (/duplicate key name/i.test(msg)) continue;
          console.error('[DB] exec failed:', msg);
          throw e;
        }
        continue;
      }
      try {
        await queryWithRetry(stmt, []);
      } catch (e: any) {
        const msg = e.message ?? '';
        if (/already exists|duplicate column name|duplicate key name/i.test(msg)) continue;
        console.error('[DB] exec failed:', msg);
        throw e;
      }
    }
  },
  pragma: (_?: string) => {},
  transaction: <TArgs extends any[]>(fn: (...args: TArgs) => any) => {
    return async (...args: TArgs) => {
      if (als.getStore()) return await fn(...args);
      const conn = await mysqlPool.getConnection();
      try {
        await conn.query('START TRANSACTION');
        const result = await als.run(conn, () => fn(...args));
        await conn.query('COMMIT');
        return result;
      } catch (e) {
        try { await conn.query('ROLLBACK'); } catch {}
        throw e;
      } finally {
        conn.release();
      }
    };
  },
};

export const pool = mysqlPool;

export async function getSetting(key: string): Promise<string | null> {
  const row = (await db.prepare('SELECT `value` FROM app_settings WHERE `key` = ?').get(key)) as any;
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  await db.prepare("INSERT INTO app_settings (`key`, `value`, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), updated_at = CURRENT_TIMESTAMP").run(key, value ?? '');
}
