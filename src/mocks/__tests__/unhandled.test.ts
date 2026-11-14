// Unhandled-request policy: /api/* requests error, everything else is bypassed.
import { describe, expect, it, vi } from 'vitest';
import { unhandledApiGuard } from '../unhandled';

const frame = (url: string, protocol = 'http') => ({ protocol, data: { request: new Request(url) } });

describe('unhandledApiGuard', () => {
  it('prints and throws for an unhandled /api/* request', async () => {
    const error = vi.fn();
    await expect(unhandledApiGuard({ frame: frame('http://localhost/api/v1/nope'), defaults: { error } })).rejects.toThrow(/Unhandled mock API request: GET \/api\/v1\/nope/);
    expect(error).toHaveBeenCalledOnce();
  });

  it.each(['http://localhost/assets/app.js', 'http://localhost/previews/D01-p1.svg', 'http://localhost/mockServiceWorker.js', 'https://fonts.example/x.woff2'])(
    'bypasses %s',
    async (url) => {
      const error = vi.fn();
      await expect(unhandledApiGuard({ frame: frame(url), defaults: { error } })).resolves.toBeUndefined();
      expect(error).not.toHaveBeenCalled();
    },
  );

  it('bypasses non-http frames (e.g. WebSocket)', async () => {
    const error = vi.fn();
    await expect(unhandledApiGuard({ frame: { protocol: 'ws', data: {} }, defaults: { error } })).resolves.toBeUndefined();
    expect(error).not.toHaveBeenCalled();
  });
});
