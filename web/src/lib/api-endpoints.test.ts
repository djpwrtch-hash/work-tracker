import { beforeEach, describe, expect, it, vi } from 'vitest';

const { api } = vi.hoisted(() => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('./api', () => ({ api }));

import { apiEndpoints } from './api-endpoints';

describe('apiEndpoints', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
  });

  it('builds notification endpoints', () => {
    const params = { page: 2 };
    apiEndpoints.notifications.list(params);
    apiEndpoints.notifications.markRead('n1');
    apiEndpoints.notifications.markAllRead();
    apiEndpoints.notifications.delete('n1');
    apiEndpoints.notifications.deleteAll();
    apiEndpoints.notifications.stats();

    expect(api.get).toHaveBeenCalledWith('/notifications', { params });
    expect(api.post).toHaveBeenCalledWith('/notifications/n1/read');
    expect(api.post).toHaveBeenCalledWith('/notifications/read-all');
    expect(api.delete).toHaveBeenCalledWith('/notifications/n1');
    expect(api.delete).toHaveBeenCalledWith('/notifications/all');
    expect(api.get).toHaveBeenCalledWith('/notifications/stats');
  });

  it('builds file endpoints and emits upload progress', () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });

    const form = new FormData();
    apiEndpoints.files.upload(form);
    const config = api.post.mock.calls[0][2];
    config.onUploadProgress({ loaded: 5 });
    expect(dispatchEvent).not.toHaveBeenCalled();
    config.onUploadProgress({ loaded: 5, total: 10 });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);

    apiEndpoints.files.list({ page: 1 });
    apiEndpoints.files.download('f1');
    apiEndpoints.files.delete('f1');

    expect(api.post).toHaveBeenCalledWith('/files/upload', form, expect.objectContaining({ headers: { 'Content-Type': 'multipart/form-data' } }));
    expect(api.get).toHaveBeenCalledWith('/files', { params: { page: 1 } });
    expect(api.get).toHaveBeenCalledWith('/files/f1/download', { responseType: 'blob' });
    expect(api.delete).toHaveBeenCalledWith('/files/f1');

    vi.unstubAllGlobals();
  });

  it('builds security endpoints', () => {
    apiEndpoints.security.policy();
    apiEndpoints.security.updatePolicy({ mfa: true });
    apiEndpoints.security.auditLog({ page: 1 });
    apiEndpoints.security.sessions();

    expect(api.get).toHaveBeenCalledWith('/security/policy');
    expect(api.put).toHaveBeenCalledWith('/security/policy', { mfa: true });
    expect(api.get).toHaveBeenCalledWith('/security/audit', { params: { page: 1 } });
    expect(api.get).toHaveBeenCalledWith('/security/sessions');
  });
});
