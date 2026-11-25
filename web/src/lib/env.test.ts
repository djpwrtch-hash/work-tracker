import { afterEach, describe, expect, it } from 'vitest';
import { getEnv, isProduction } from './env';

describe('env', () => {
  const original = process.env.WT_TEST_ENV_VALUE;
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (original === undefined) delete process.env.WT_TEST_ENV_VALUE;
    else process.env.WT_TEST_ENV_VALUE = original;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('falls back to process.env when import.meta.env has no value', () => {
    process.env.WT_TEST_ENV_VALUE = 'from-process';
    expect(getEnv('WT_TEST_ENV_VALUE')).toBe('from-process');
  });

  it('returns undefined for a missing variable', () => {
    delete process.env.WT_TEST_ENV_VALUE;
    expect(getEnv('WT_TEST_ENV_VALUE')).toBeUndefined();
  });

  it('reports non-production in the test environment', () => {
    process.env.NODE_ENV = 'test';
    expect(isProduction()).toBe(false);
  });
});
