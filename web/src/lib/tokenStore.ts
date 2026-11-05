let _accessToken: string | null = null;
let _refreshPromise: Promise<string> | null = null;
const _tokenListeners = new Set<(token: string | null) => void>();
const _retryQueue: Array<{ resolve: (token: string) => void; reject: (err: any) => void }> = [];

export const setAccessToken = (t: string | null) => { _accessToken = t; _tokenListeners.forEach(fn => fn(t)); };
export const getAccessToken = () => _accessToken;
export const onTokenChange = (fn: (token: string | null) => void) => { _tokenListeners.add(fn); return () => { _tokenListeners.delete(fn); }; };
export const getRetryQueue = () => _retryQueue;
export const setRefreshPromise = (p: Promise<string> | null) => { _refreshPromise = p; };
export const getRefreshPromise = () => _refreshPromise;
