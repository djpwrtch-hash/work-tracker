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

/** Defaults optimized for check-in/check-out use case:
 * - goodAccuracy: 50m (realistic for browser geolocation with high accuracy)
 * - timeoutMs: 15s (high accuracy needs more time on mobile)
 * - maximumAge: 0 (force fresh location for check-in)
 * - maxAttempts: 3 (try up to 3 times for better accuracy)
 */
const DEFAULT_GOOD_ACCURACY = 50;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAXIMUM_AGE = 0;
const DEFAULT_MAX_ATTEMPTS = 3;

interface LocationError {
  code: 'PERMISSION_DENIED' | 'POSITION_UNAVAILABLE' | 'TIMEOUT' | 'sNKNOWN';
  message: string;
}

export interface CaptureResult {
  location: BestLocation | null;
  error: LocationError | null;
}

export function captureLocation(options: CaptureOptions = {}): Promise<CaptureResult> {
  const goodAccuracy = options.goodAccuracy ?? DEFAULT_GOOD_ACCURACY;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maximumAge = options.maximumAge ?? DEFAULT_MAXIMUM_AGE;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const onProgress = options.onProgress;

  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      const host = window.location.hostname;
      const isLocalhost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
      const isLanIp = /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.endsWith('.local');
      let msg = 'Location requires HTTPS. Please use https:// or localhost.';
      if (isLanIp && !isLocalhost) {
        msg = `Location blocked: ${host} is not a secure context. Use http://localhost:42780 on this device, or run "npm run dev:https" and trust the self-signed cert (web/certs/) for LAN HTTPS.`;
      }
      console.warn('[Location] Not a secure context —', host, isLanIp ? '(LAN IP)' : '');
      resolve({ location: null, error: { code: 'PERMISSION_DENIED', message: msg } });
      return;
    }
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      console.warn('[Location] Geolocation not available (server or unsupported browser)');
      resolve({ location: null, error: { code: 'sNKNOWN', message: 'Geolocation not supported' } });
      return;
    }

    let best: BestLocation | null = null;
    let attempts = 0;

    const attempt = () => {
      attempts++;

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const candidate: BestLocation = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: Math.round(pos.coords.accuracy),
            locationCapturedAt: new Date().toISOString(),
            success: true,
          };

          // Keep the best (most accurate) reading
          if (!best || candidate.accuracy < best.accuracy) {
            best = candidate;
          }

          onProgress?.(best.accuracy, best.success);

          // If accuracy is good enough, resolve immediately
          if (best.accuracy <= goodAccuracy) {
            resolve({ location: best, error: null });
            return;
          }

          // If we have more attempts, try again for better accuracy
          if (attempts < maxAttempts) {
            setTimeout(attempt, 100);
          } else {
            // No more attempts, resolve with best we have
            resolve({ location: best, error: null });
          }
        },
        (err) => {
          const locationError: LocationError = {
            code: 'sNKNOWN',
            message: err.message,
          };

          if (err.code === err.PERMISSION_DENIED) {
            locationError.code = 'PERMISSION_DENIED';
            locationError.message = 'Location permission denied. Please enable location access in your browser settings.';
          } else if (err.code === err.POSITION_UNAVAILABLE) {
            locationError.code = 'POSITION_UNAVAILABLE';
            locationError.message = 'Location unavailable. Please check your device settings.';
          } else if (err.code === err.TIMEOUT) {
            locationError.code = 'TIMEOUT';
            locationError.message = 'Location request timed out. Please try again.';
          }

          console.error('[Location] Geolocation error:', locationError.code, locationError.message);

          // Retry on TIMEOUT, fail fast on PERMISSION_DENIED
          if (locationError.code === 'TIMEOUT' && attempts < maxAttempts) {
            setTimeout(attempt, 500);
            return;
          }
          if (locationError.code === 'POSITION_UNAVAILABLE' && attempts < maxAttempts && !best) {
            setTimeout(attempt, 500);
            return;
          }

          // If we have a previous best reading, use it
          if (best) {
            resolve({ location: best, error: locationError });
          } else {
            resolve({ location: null, error: locationError });
          }
        },
        {
          enableHighAccuracy: true,
          timeout: timeoutMs,
          maximumAge: maximumAge,
        }
      );
    };

    // Start the first attempt
    attempt();
  });
}

/** Helper to get a user-friendly error message from a location result */
export function getLocationErrorMessage(err: unknown): string {
  if (!err) return 'snknown location error';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  const e = err as LocationError;
  if (e && e.code && e.message) return e.message;
  return 'Failed to capture location';
}

export type { LocationError };
