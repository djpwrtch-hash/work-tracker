import dotenv from 'dotenv';
dotenv.config();
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// Resolved per call rather than at import time, so the location can be changed at
// runtime (and pointed at a temporary directory by tests).
function backupDir(): string {
  return process.env.BACKUP_DIR || path.join(process.cwd(), 'backup');
}

// mysqldump is not on PATH in a normal Windows install, so fall back to the
// standard MySQL Server directories before giving up. Linux containers (Railway,
// Docker) have it in /usr/bin.
function resolveMysqldump(): string | null {
  if (process.env.MYSQLDUMP_PATH) return process.env.MYSQLDUMP_PATH;
  const exe = process.platform === 'win32' ? 'mysqldump.exe' : 'mysqldump';
  const dirs = (process.env.PATH || '').split(path.delimiter);
  if (dirs.some((d) => d && fs.existsSync(path.join(d, exe)))) return exe;
  const candidates = [
    `/usr/bin/${exe}`,
    `/usr/local/bin/${exe}`,
    'C:\\Program Files\\MySQL\\MySQL Server 8.4\\bin\\mysqldump.exe',
    'C:\\Program Files\\MySQL\\MySQL Server 8.0\\bin\\mysqldump.exe',
    'C:\\Program Files\\MySQL\\MySQL Server 5.7\\bin\\mysqldump.exe',
    'C:\\xampp\\mysql\\bin\\mysqldump.exe',
  ];
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

function databaseTarget(): { host: string; port: string; user: string; pass: string; database: string } {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    try {
      const url = new URL(databaseUrl);
      return {
        host: url.hostname || process.env.MYSQL_HOST || 'localhost',
        port: url.port || process.env.MYSQL_PORT || '3306',
        user: decodeURIComponent(url.username) || process.env.MYSQL_USER || 'root',
        pass: decodeURIComponent(url.password) || process.env.MYSQL_PASSWORD || '',
        database: url.pathname.replace(/^\//, '').split('?')[0] || process.env.MYSQL_DATABASE || 'hr',
      };
    } catch {}
  }
  return {
    host: process.env.MYSQL_HOST || 'localhost',
    port: process.env.MYSQL_PORT || '3306',
    user: process.env.MYSQL_USER || 'root',
    pass: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'hr',
  };
}

function ensureBackupDir(): string {
  const dir = backupDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function timestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

export async function createBackup(prefix = 'employee-tracker'): Promise<string> {
  const dir = ensureBackupDir();
  const { host, port, user, pass, database } = databaseTarget();
  const backupName = `${prefix}-${timestamp()}.sql`;
  const backupPath = path.join(dir, backupName);
  const dump = resolveMysqldump();
  if (!dump) throw new Error('mysqldump not found. Add it to PATH or set MYSQLDUMP_PATH (see server/src/lib/backup.ts)');
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(backupPath);
    const child = spawn(dump, ['-h', host, '-P', port, '-u', user, database, '--single-transaction', '--quick', '--routines', '--no-tablespaces'], {
      env: { ...process.env, MYSQL_PWD: pass },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(out);
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      out.close();
      if (code === 0) resolve();
      else reject(new Error(`mysqldump failed (${code}): ${err}`));
    });
  });
  console.log(`[Backup] Created: ${backupPath}`);
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    if (files.length > 7) {
      for (const f of files.slice(0, files.length - 7)) {
        fs.unlinkSync(path.join(dir, f));
        console.log(`[Backup] Rotated old: ${f}`);
      }
    }
  } catch {}
  return backupPath;
}

export function listBackups(): string[] {
  const dir = ensureBackupDir();
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .reverse();
  return files.map((f) => {
    const stat = fs.statSync(path.join(dir, f));
    return `${f}  (${(stat.size / 1024).toFixed(1)} KB, ${stat.mtime.toISOString()})`;
  });
}

if (process.argv[1] === import.meta.url || process.argv[1]?.endsWith('backup.ts')) {
  const cmd = process.argv[2];
  if (cmd === 'list') {
    const list = listBackups();
    if (list.length === 0) {
      console.log('No backups found.');
    } else {
      console.log('Backups:');
      list.forEach((b) => console.log(`  ${b}`));
    }
  } else {
    createBackup()
      .then((p) => console.log(`Backup complete: ${p}`))
      .catch((e) => { console.error(e.message); process.exit(1); });
  }
}
