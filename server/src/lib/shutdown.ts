// Single place to trigger the graceful shutdown sequence. server.ts registers the
// real handler (close http server -> close socket.io -> end the DB pool); anything
// else (e.g. the local stop endpoint used by STOP.bat) just calls requestShutdown().

type ShutdownHandler = (reason: string) => Promise<void>;

let handler: ShutdownHandler | null = null;

export function registerShutdown(fn: ShutdownHandler): void {
  handler = fn;
}

export async function requestShutdown(reason: string): Promise<void> {
  if (handler) {
    await handler(reason);
    return;
  }
  process.exit(0);
}
