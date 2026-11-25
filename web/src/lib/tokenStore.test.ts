import { describe, expect, it, vi } from 'vitest';
import {
  setAccessToken,
  getAccessToken,
  onTokenChange,
  getRetryQueue,
  setRefreshPromise,
  getRefreshPromise,
} from './tokenStore';

describe('tokenStore', () => {
  it('stores and clears the access token', () => {
    setAccessToken('access-1');
    expect(getAccessToken()).toBe('access-1');
    setAccessToken(null);
    expect(getAccessToken()).toBeNull();
  });

  it('notifies listeners and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = onTokenChange(listener);

    setAccessToken('access-2');
    expect(listener).toHaveBeenCalledWith('access-2');

    unsubscribe();
    setAccessToken('access-3');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('exposes the retry queue', () => {
    expect(Array.isArray(getRetryQueue())).toBe(true);
  });

  it('stores and clears the refresh promise', async () => {
    const promise = Promise.resolve('refreshed');
    setRefreshPromise(promise);
    expect(getRefreshPromise()).toBe(promise);
    setRefreshPromise(null);
    expect(getRefreshPromise()).toBeNull();
    await promise;
  });
});
