export interface BestLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  locationCapturedAt: string;
  success: boolean;
}

export interface CaptureOptions {
  goodAccuracy?: number;
  timeoutMs?: number;
  maximumAge?: number;
  maxAttempts?: number;
  onProgress?: (accuracy: number, success: boolean) => void;
}

/** Defaults optimized for check-in/check-out use case. */
const DEFAULT_GOOD_ACCURACY = 50;
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAXIMUM_AGE = 30000;
const DEFAULT_MAX_ATTEMPTS = 3;
const LOW_ACCURACY_TIMEOUT_MS = 5000;

interface LocationError {
  code: 'PERMISSION_DENIED' | 'POSITION_UNAVAILABLE' | 'TIMEOUT' | 'UNKNOWN';
  message: string;
}

export interface CaptureResult {
  location: BestLocation | null;
  error: LocationError | null;
}

export async function captureLocation(options: CaptureOptions = {}): Promise<CaptureResult> {
  const goodAccuracy = options.goodAccuracy ?? DEFAULT_GOOD_ACCURACY;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maximumAge = options.maximumAge ?? DEFAULT_MAXIMUM_AGE;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const onProgress = options.onProgress;

  // 1. Secure context check
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    const host = window.location.hostname;
    const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    const isLanIp = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.endsWith('.local');
    let msg = 'Location requires HTTPS. Please use https:// or localhost.';
    if (isLanIp && !isLocalhost) {
      msg = `Location blocked: ${host} is not a secure context. Use http://localhost:42780 on this device, or run "npm run dev:https".`;
    }
    console.warn('[Location] Not a secure context —', host);
    return { location: null, error: { code: 'PERMISSION_DENIED', message: msg } };
  }
  if (typeof window === 'undefined' || !('geolocation' in navigator)) {
    return { location: null, error: { code: 'UNKNOWN', message: 'Geolocation is not supported by this browser.' } };
  }

  // 2. Helper to run one getCurrentPosition attempt (called synchronously to preserve user gesture)
  const runAttempt = (enableHighAccuracy: boolean, timeout: number): Promise<{ candidate: BestLocation | null; error: LocationError | null }> => {
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const candidate: BestLocation = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: Math.round(pos.coords.accuracy),
            locationCapturedAt: new Date().toISOString(),
            success: true,
          };
          resolve({ candidate, error: null });
        },
        (err) => {
          const locationError: LocationError = { code: 'UNKNOWN', message: err.message || 'Failed to capture location' };
          if (err.code === err.PERMISSION_DENIED) {
            locationError.code = 'PERMISSION_DENIED';
            locationError.message = 'Location permission denied. Enable it in your browser settings, then retry.';
          } else if (err.code === err.POSITION_UNAVAILABLE) {
            locationError.code = 'POSITION_UNAVAILABLE';
            locationError.message = 'Location unavailable. Move outdoors or check your device settings.';
          } else if (err.code === err.TIMEOUT) {
            locationError.code = 'TIMEOUT';
            locationError.message = 'Location request timed out. Please try again.';
          }
          console.error('[Location] Geolocation error:', locationError.code, locationError.message);
          resolve({ candidate: null, error: locationError });
        },
        { enableHighAccuracy, timeout, maximumAge }
      );
    });
  };

  // 3. Phase 1: high accuracy (up to maxAttempts)
  let best: BestLocation | null = null;
  let lastError: LocationError | null = null;

  for (let i = 0; i < maxAttempts; i++) {
    const { candidate, error } = await runAttempt(true, timeoutMs);
    if (candidate) {
      if (!best || candidate.accuracy < best.accuracy) best = candidate;
      onProgress?.(best.accuracy, true);
      if (best.accuracy <= goodAccuracy) {
        return { location: best, error: null };
      }
    } else if (error) {
      lastError = error;
      if (error.code === 'PERMISSION_DENIED') {
        // Fail fast on permission denial — no point retrying
        return { location: null, error };
      }
      // TIMEOUT / POSITION_UNAVAILABLE → try next attempt
    }
    if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, 200));
  }

  // 4. Phase 2: fallback to low accuracy (Wi-Fi/IP) if no good reading
  if (!best || best.accuracy > goodAccuracy) {
    const { candidate, error } = await runAttempt(false, LOW_ACCURACY_TIMEOUT_MS);
    if (candidate) {
      if (!best || candidate.accuracy < best.accuracy) best = candidate;
      onProgress?.(best.accuracy, true);
    } else if (error) {
      lastError = error;
      if (error.code === 'PERMISSION_DENIED') {
        return { location: null, error };
      }
    }
  }

  if (best) {
    return { location: best, error: null };
  }
  return { location: null, error: lastError ?? { code: 'UNKNOWN', message: 'Failed to capture location' } };
}

/** Check the current permission state for geolocation (non-blocking, best effort). */
export async function checkPermissionState(): Promise<'granted' | 'prompt' | 'denied' | 'unknown'> {
  if (typeof navigator === 'undefined' || !navigator.permissions || typeof navigator.permissions.query !== 'function') {
    return 'unknown';
  }
  try {
    const perm = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    if (perm.state === 'granted' || perm.state === 'prompt' || perm.state === 'denied') return perm.state as 'granted' | 'prompt' | 'denied';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Helper to get a user-friendly error message from a location result */
export function getLocationErrorMessage(err: unknown): string {
  if (!err) return 'Unknown location error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  const e = err as LocationError;
  if (e && e.code && e.message) return e.message;
  return 'Failed to capture location';
}

export type { LocationError };
