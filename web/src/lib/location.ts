export interface BestLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  locationCapturedAt: string;
  success: boolean;
  /** Where the position came from: device GPS or coarse IP geolocation. */
  source?: 'gps' | 'ip';
}

export interface CaptureOptions {
  goodAccuracy?: number;
  timeoutMs?: number;
  maximumAge?: number;
  maxAttempts?: number;
  /** Set false to respect the user's "Grant IP logging" toggle — skips the IP-based fallback entirely. */
  ipEnabled?: boolean;
  /** Collection window for the high-precision GPS watch (ms). */
  windowMs?: number;
  /** Stop the window early once a fix is this accurate (metres). */
  targetAccuracy?: number;
  onProgress?: (accuracy: number, success: boolean) => void;
}

interface LocationError {
  code: 'PERMISSION_DENIED' | 'POSITION_UNAVAILABLE' | 'TIMEOUT' | 'UNKNOWN';
  message: string;
}

export interface CaptureResult {
  location: BestLocation | null;
  error: LocationError | null;
}

/** Fetch a coarse (~5 km) location via IP geolocation as a last resort fallback. */
export async function fetchIpLocation(): Promise<BestLocation> {
  const res = await fetch('https://ipapi.co/json/', { cache: 'no-store' });
  if (!res.ok) throw new Error(`IP geolocation failed (${res.status})`);
  const d: any = await res.json();
  const latitude = Number(d?.latitude);
  const longitude = Number(d?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error('IP geolocation returned no coordinates');
  return {
    latitude,
    longitude,
    accuracy: 5000,
    locationCapturedAt: new Date().toISOString(),
    success: true,
    source: 'ip',
  };
}

export async function captureLocation(options: CaptureOptions = {}): Promise<CaptureResult> {
  const ipEnabled = options.ipEnabled ?? true;
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

  // 2. High-precision collection window: use watchPosition to gather repeated readings and
  // keep the best (lowest accuracy). Stop early once we hit the target (default 5 m).
  const windowMs = options.windowMs ?? 20000;
  const targetAccuracy = options.targetAccuracy ?? 5;
  const minimumGpsAccuracy = 50; // GPS fixes up to 50 m still beat IP's ~5 km

  const collectHighAccuracy = (): Promise<{ candidate: BestLocation | null; error: LocationError | null }> => {
    return new Promise((resolve) => {
      let best: BestLocation | null = null;
      let lastErr: LocationError | null = null;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        try { navigator.geolocation.clearWatch(watchId); } catch { /* ignore */ }
        clearTimeout(timer);
        resolve({ candidate: best, error: lastErr });
      };
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const accuracy = Math.round(pos.coords.accuracy);
          const candidate: BestLocation = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy,
            locationCapturedAt: new Date().toISOString(),
            success: true,
            source: 'gps',
          };
          if (!best || candidate.accuracy < best.accuracy) {
            best = candidate;
            onProgress?.(candidate.accuracy, true);
          }
          if (candidate.accuracy <= targetAccuracy) finish(); // ideal fix reached — stop early
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
          lastErr = locationError;
          if (err.code === err.PERMISSION_DENIED) finish(); // hard fail — no point waiting out the window
        },
        { enableHighAccuracy: true, timeout: windowMs, maximumAge: 0 }
      );
      const timer = setTimeout(finish, windowMs);
    });
  };

  const { candidate: best, error: lastError } = await collectHighAccuracy();

  // 3. Acceptance criteria: any GPS fix up to minimumGpsAccuracy beats the IP fallback.
  if (best && best.accuracy <= minimumGpsAccuracy) {
    return { location: best, error: null };
  }

  // 4. GPS returned nothing usable. Fall back to coarse IP location (~5 km) only when the failure
  // is permission/availability related (not timeout/noise), only if online, and only if the user
  // granted IP logging. Otherwise respect the toggle and return the error.
  if (!ipEnabled) {
    console.warn('[Location] IP-based fallback skipped — IP logging is disabled in your profile.');
    return { location: null, error: lastError ?? { code: 'PERMISSION_DENIED', message: 'IP-based fallback disabled. Enable location or IP logging in your profile, then retry.' } };
  }
  // If we have any coarse GPS fix at all, prefer it over IP.
  if (best) {
    return { location: best, error: null };
  }
  if (lastError && (lastError.code === 'PERMISSION_DENIED' || lastError.code === 'POSITION_UNAVAILABLE')) {
    try {
      const ip = await fetchIpLocation();
      if (ip) return { location: ip, error: null };
    } catch {
      // IP lookup failed (offline / blocked) — return the original error
    }
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
