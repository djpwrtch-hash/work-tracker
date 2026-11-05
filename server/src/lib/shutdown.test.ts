// Regression tests for the graceful-stop path added for STOP.bat.
//
// Before this, stopping the app was a hard kill: server/src/server.ts had no
// SIGINT/SIGTERM handler, so in-flight requests and MySQL sessions were cut off.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { registerShutdown, requestShutdown } from '../lib/shutdown.js';

const TOKEN = 'test-stop-token-123';

describe('graceful shutdown', () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    // The route only exists when STOP_TOKEN is provided (server/src/app.ts).
    process.env.STOP_TOKEN = TOKEN;
    app = createApp();
  });

  afterAll(() => {
    delete process.env.STOP_TOKEN;
  });

  it('rejects a stop request without a token', async () => {
    const res = await request(app).post('/internal/stop');
    expect(res.status).toBe(403);
  });

  it('rejects a stop request with the wrong token', async () => {
    const res = await request(app).post('/internal/stop').set('x-stop-token', 'not-the-token');
    expect(res.status).toBe(403);
  });

  it('does not register the route when no token is configured', async () => {
    delete process.env.STOP_TOKEN;
    const bareApp = createApp();
    const res = await request(bareApp).post('/internal/stop').set('x-stop-token', TOKEN);
    // Falls through to the 404 handler - the endpoint is disabled by default.
    expect(res.status).toBe(404);
    process.env.STOP_TOKEN = TOKEN;
  });

  it('accepts the correct token and acknowledges the stop', async () => {
    let reason = '';
    registerShutdown(async (r) => { reason = r; });
    const res = await request(app).post('/internal/stop').set('x-stop-token', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('stopping');
    // The shutdown itself runs on a timer; give it a moment.
    await new Promise((r) => setTimeout(r, 250));
    expect(reason).toBe('stop endpoint');
  });

  it('exits the process when no handler is registered', async () => {
    registerShutdown(null as unknown as () => Promise<void>);
    const originalExit = process.exit;
    let exitCode: number | undefined;
    (process as any).exit = (code?: number) => { exitCode = code; };
    try {
      await requestShutdown('unit-test');
    } finally {
      (process as any).exit = originalExit;
    }
    expect(exitCode).toBe(0);
  });
});
