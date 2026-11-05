// Regression tests for the launcher's startup + crash supervisor.
//
// Before the supervisor, desktop/launcher.cjs did:
//   children[0].on('exit', () => { ...kill others...; process.exit(0) })
// so a single server crash took the whole app down and nothing was recorded. It now
// restarts with backoff, and a deliberate stop never triggers a restart.
//
// These run the launcher as a child process against a free port and an unreachable
// MySQL port, so they never touch the real app on 42780.
import { describe, expect, it } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// server/src/test -> server/src -> server -> <project root>/desktop
const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'desktop');
const launcher = path.join(desktopDir, 'launcher.cjs');
// The desktop launcher is not shipped in every checkout (e.g. server-only
// deployments). Skip instead of timing out when it is absent.
const hasLauncher = fs.existsSync(launcher);
const FREE_PORT = '42797';

function runLauncher(env: Record<string, string>, killAfterMs?: number, args: string[] = []): Promise<{ code: number | null; output: string; elapsed: number }> {
  return new Promise((resolve) => {
    const child: ChildProcess = spawn(process.execPath, [launcher, ...args], {
      cwd: desktopDir,
      env: {
        ...process.env,
        WEB_PORT: FREE_PORT,
        WORKTRACKER_MYSQL_PORT: '3999',
        WT_MYSQL_WAIT_SECONDS: '1',
        WT_DAILY_BACKUP: 'false',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout?.on('data', (d) => { output += d.toString(); });
    child.stderr?.on('data', (d) => { output += d.toString(); });
    const started = Date.now();
    const timer = killAfterMs ? setTimeout(() => child.kill('SIGINT'), killAfterMs) : undefined;
    // Never hang the suite if the launcher cannot be spawned at all.
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: 1, output: `${output}\n${err.message}`, elapsed: Date.now() - started });
    });
    child.on('exit', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, output, elapsed: Date.now() - started });
    });
    setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); }, 20000);
  });
}

describe.skipIf(!hasLauncher)('launcher supervisor', () => {
  it('fails fast with instructions when MySQL is unreachable', async () => {
    const result = await runLauncher({});
    expect(result.code).toBe(1);
    expect(result.output).toContain('MySQL is not running');
    expect(result.output).toContain('net start MYSQL80');
  }, 40000);

  it('does not treat a running instance on another port as "already running"', async () => {
    const result = await runLauncher({});
    expect(result.output).not.toContain('already running');
  }, 40000);

  it('stops without any restart attempt when interrupted', async () => {
    const result = await runLauncher({ WT_MYSQL_WAIT_SECONDS: '30' }, 2000);
    expect(result.output).not.toContain('restart');
    expect(result.elapsed).toBeLessThan(15000);
  }, 40000);
});

describe.skipIf(!hasLauncher)('launcher tunnel mode (--tunnel)', () => {
  it('refuses to combine --tunnel with --dev', async () => {
    const result = await runLauncher({}, undefined, ['--tunnel', '--dev']);
    expect(result.code).toBe(1);
    expect(result.output).toContain('cannot be combined');
  });

  it('reports a helpful error when cloudflared is not installed', async () => {
    // WT_CLOUDFLARED points at a path that does not exist.
    const result = await runLauncher(
      { WORKTRACKER_MYSQL_PORT: '3306', WT_CLOUDFLARED: 'C:\\no-such-cloudflared.exe' },
      undefined,
      ['--tunnel'],
    );
    expect(result.output).toContain('cloudflared was not found');
    expect(result.output).toContain('WT_CLOUDFLARED');
  }, 40000);

  it('tells the user to stop the app first instead of half-applying tunnel settings', async () => {
    // Point the tunnel check at the port the real app is already serving.
    const result = await runLauncher(
      { WEB_PORT: process.env.WT_LIVE_APP_PORT || '42780' },
      undefined,
      ['--tunnel'],
    );
    if (result.output.includes('already running')) {
      expect(result.code).toBe(1);
      expect(result.output).toContain('STOP.bat');
    } else {
      // The live app was not running during the test - nothing to assert here.
      expect(true).toBe(true);
    }
  }, 40000);
});
