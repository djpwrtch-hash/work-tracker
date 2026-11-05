import axios from 'axios';
import { getEnv } from './env';

const apiOrigin = (getEnv('VITE_API_URL') ?? getEnv('NEXT_PUBLIC_API_URL'))?.replace(/\/+$/, '');

export const api = axios.create({
  baseURL: apiOrigin ? `${apiOrigin}/api/v1` : '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
  timeout: 30000,
});

export { setAccessToken, getAccessToken, onTokenChange } from './tokenStore';
import { getAccessToken, setAccessToken, getRefreshPromise, setRefreshPromise } from './tokenStore';

export async function doRefresh(): Promise<string> {
  const existing = getRefreshPromise();
  if (existing) return existing;
  const promise = api
    .post<{ accessToken: string }>('/auth/refresh', {})
    .then((res) => {
      setAccessToken(res.data.accessToken);
      // Re-auth socket with fresh token to prevent "Invalid token" after refresh
      import('./socket').then((m) => m.initializeSocket(res.data.accessToken)).catch(() => {});
      return getAccessToken() as string;
    })
    .catch((err) => {
      setAccessToken(null);
      throw err;
    })
    .finally(() => {
      setRefreshPromise(null);
    });
  setRefreshPromise(promise);
  return promise;
}

export function getApiError(error: unknown, fallback: string) {
  if (axios.isAxiosError<{ error?: unknown }>(error)) {
    const data = error.response?.data as { error?: unknown } | undefined;
    if (typeof data?.error === 'string') return data.error;
    if (data?.error && typeof data.error === 'object' && 'message' in (data.error as object) && typeof (data.error as { message?: unknown }).message === 'string') {
      return (data.error as { message: string }).message;
    }
  }
  return fallback;
}

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token && config.headers) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    if (!error.response) {
      console.error('[API] Network error:', error.message);
      return Promise.reject(error);
    }
    const orig = error.config;
    if (error.response?.status === 401 && orig && !orig._retry) {
      if (orig.url?.includes('/auth/login') || orig.url?.includes('/auth/refresh') || orig.url?.includes('/auth/logout')) return Promise.reject(error);
      orig._retry = true;
      try {
        // If a refresh is already in progress, wait for it instead of triggering another
        const pending = getRefreshPromise();
        if (pending) {
          await pending;
        } else {
          await doRefresh();
        }
        const token = getAccessToken();
        if (!token) throw new Error('No token after refresh');
        orig.headers.Authorization = `Bearer ${token}`;
        return api(orig);
      } catch {
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('session_expired', 'true');
          window.location.href = '/login';
        }
        return Promise.reject(error);
      }
    }
    return Promise.reject(error);
  }
);

export const analyticsApi = {
  productivity: (params?: any) => api.get('/analytics/productivity', { params }),
  departmentPerformance: () => api.get('/analytics/department-performance'),
  employeeProductivity: (params?: any) => api.get('/analytics/employee-productivity', { params }),
  managerDashboard: (managerId: string) => api.get('/analytics/manager-dashboard', { params: { managerId } }),
};

export const overtimeApi = {
  getMy: (year: number, month: number) => api.get(`/attendance/overtime/my/${year}/${month}`),
  getAll: (year: number, month: number) => api.get(`/attendance/overtime/${year}/${month}`),
};
