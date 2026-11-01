import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { aturCacheSebentarUntukTes, cacheSebentar } from '../cache-memori';

beforeEach(() => aturCacheSebentarUntukTes(true));
afterEach(() => { aturCacheSebentarUntukTes(false); vi.useRealTimers(); });

it('memakai hasil yang sama selama belum kedaluwarsa, lalu membaca ulang', async () => {
  vi.useFakeTimers();
  const muat = vi.fn(async () => ({ n: muat.mock.calls.length }));
  const a = await cacheSebentar('k', 1000, muat);
  const b = await cacheSebentar('k', 1000, muat);
  expect(b).toBe(a);
  expect(muat).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1001);
  await cacheSebentar('k', 1000, muat);
  expect(muat).toHaveBeenCalledTimes(2);
});

it('pemanggil bersamaan berbagi satu pembacaan', async () => {
  const muat = vi.fn(() => new Promise<number>(r => setTimeout(() => r(1), 5)));
  const [a, b] = await Promise.all([cacheSebentar('x', 1000, muat), cacheSebentar('x', 1000, muat)]);
  expect([a, b]).toEqual([1, 1]);
  expect(muat).toHaveBeenCalledTimes(1);
});

it('kegagalan tidak disimpan', async () => {
  const muat = vi.fn().mockRejectedValueOnce(new Error('db')).mockResolvedValueOnce(7);
  await expect(cacheSebentar('g', 1000, muat)).rejects.toThrow('db');
  await expect(cacheSebentar('g', 1000, muat)).resolves.toBe(7);
});

it('di tes biasa tidak menyimpan apa-apa', async () => {
  aturCacheSebentarUntukTes(false);
  const muat = vi.fn(async () => 1);
  await cacheSebentar('t', 1000, muat);
  await cacheSebentar('t', 1000, muat);
  expect(muat).toHaveBeenCalledTimes(2);
});
