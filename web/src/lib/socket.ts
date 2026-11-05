import { io, Socket } from 'socket.io-client';
import { getAccessToken } from './tokenStore';

let socket: Socket | null = null;
let currentToken: string | null = null;
let socketUrl: string | null = null;

const isJwtExpired = (token: string) => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
};

import { getEnv } from './env';

// The app runs on a single origin (Express serves API + frontend on 42780), so the
// socket should normally connect to whatever host serves the page. Only when the
// page is served by the Vite dev server (a different port) do we need to point at
// the dev API port from VITE_API_PORT.
const DEV_API_PORT = '42781';

export const resolveSocketUrl = (): string => {
  const explicit = getEnv('VITE_API_URL') ?? getEnv('NEXT_PUBLIC_API_URL');
  if (explicit) return explicit.replace(/\/$/, '');

  if (typeof window !== 'undefined' && window.location) {
    const { origin, hostname, port, protocol } = window.location;
    const isDevServer = port === '42780' && hostname !== '';
    // Vite dev server (port 42780) proxies nothing for sockets → talk to the dev API.
    if (isDevServer && import.meta.env?.DEV) {
      return `${protocol}//${hostname}:${DEV_API_PORT}`;
    }
    return origin;
  }
  return `http://localhost:42780`;
};

export const initializeSocket = (token: string) => {
  const API_URL = resolveSocketUrl();

  if (socket && (currentToken !== token || socketUrl !== API_URL)) {
    socket.close();
    socket = null;
  }

  if (!socket) {
    currentToken = token;
    socketUrl = API_URL;
    socket = io(API_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      randomizationFactor: 0.5,
    });

    socket.on('connect', () => {
    });

    socket.on('disconnect', () => {
    });

    socket.on('connect_error', (error: any) => {
      const msg = error?.message ?? String(error);
      // HMR / fast refresh causes a benign "closed before the connection is established"
      if (msg.includes('closed before the connection') || (msg.includes('websocket error') && !socket?.connected)) {
        return;
      }
      console.error('[Socket] Connection error:', error);
    });

    socket.on('reconnect_attempt', () => {
      const fresh = getAccessToken();
      if (!fresh || fresh !== currentToken) {
        socket?.close();
        return;
      }
      if (isJwtExpired(fresh)) {
        import('./api').then(m => m.doRefresh())
          .then((newToken) => {
            if (socket && newToken !== currentToken) {
              currentToken = newToken as string;
              socket.auth = { token: newToken };
            }
          })
          .catch(() => {
            socket?.close();
          });
      }
    });
  }

  return socket;
};

export const getSocket = () => {
  if (!socket) throw new Error('Socket not initialized');
  return socket;
};

export const getSocketSafe = () => socket;

export const disconnectSocket = () => {
  if (socket) {
    socket.close();
    socket = null;
    currentToken = null;
  }
};

export { socket };

export const joinUserRoom = (userId: string) => {
  const tryJoin = () => {
    const s = getSocketSafe();
    if (s?.connected) { s.emit('join-user', userId); return true; }
    return false;
  };
  if (tryJoin()) return;
  const timer = setInterval(() => { if (tryJoin() && timer) clearInterval(timer); }, 500);
  setTimeout(() => { clearInterval(timer); }, 10000);
};

export const joinTeamRoom = (teamName: string) => {
  const s = getSocketSafe();
  if (s?.connected) s.emit('join-team', teamName);
};

export const leaveTeamRoom = (teamName: string) => {
  const s = getSocketSafe();
  if (s?.connected) s.emit('leave-team', teamName);
};

export function listenOnSocket(events: Record<string, (...args: any[]) => void>): () => void {
  let attached: Socket | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const attach = () => {
    const s = getSocketSafe();
    if (!s) return false;
    attached = s;
    for (const [event, handler] of Object.entries(events)) {
      s.on(event, handler as any);
    }
    return true;
  };

  if (!attach()) {
    timer = setInterval(() => {
      if (attach() && timer) clearInterval(timer);
    }, 400);
    setTimeout(() => { if (timer) clearInterval(timer); }, 15000);
  }

  return () => {
    if (timer) clearInterval(timer);
    if (attached) {
      for (const [event, handler] of Object.entries(events)) {
        attached.off(event, handler as any);
      }
    }
  };
}
