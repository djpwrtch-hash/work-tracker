import { describe, expect, it } from 'vitest';
import { queryClient } from './queryClient';

describe('queryClient', () => {
  it('applies the app-wide query and mutation defaults', () => {
    const defaults = queryClient.getDefaultOptions();
    expect(defaults.queries?.staleTime).toBe(60_000);
    expect(defaults.queries?.retry).toBe(1);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(false);
    expect(defaults.queries?.gcTime).toBe(300_000);
    expect(defaults.mutations?.retry).toBe(1);
  });
});
