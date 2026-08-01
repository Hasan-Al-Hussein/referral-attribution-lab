import { describe, expect, it, jest } from '@jest/globals';

import { commitDemoReset } from '../src/application/commitDemoReset';

describe('committed demo reset presentation', () => {
  it('preserves presentation after failure and commits it exactly once on retry', async () => {
    const reset = jest
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('epoch pointer unavailable'))
      .mockResolvedValueOnce();
    const onCommitted = jest.fn();

    await expect(commitDemoReset(reset, onCommitted)).resolves.toEqual({
      ok: false,
      committed: false,
      message: 'epoch pointer unavailable',
    });
    expect(onCommitted).not.toHaveBeenCalled();

    await expect(commitDemoReset(reset, onCommitted)).resolves.toEqual({
      ok: true,
      committed: true,
    });
    expect(onCommitted).toHaveBeenCalledTimes(1);
  });

  it('distinguishes a committed reset from presentation refresh failure', async () => {
    const onCommitted = jest.fn(() => {
      throw new Error('navigation unavailable');
    });

    await expect(
      commitDemoReset(() => Promise.resolve(), onCommitted),
    ).resolves.toEqual({
      ok: false,
      committed: true,
      message: 'navigation unavailable',
    });
  });

  it('keeps navigation terminal when a committed presentation refresh fails', async () => {
    const calls: string[] = [];

    await expect(
      commitDemoReset(
        async () => void calls.push('persisted'),
        () => {
          calls.push('ledger');
          throw new Error('ledger unavailable');
        },
      ),
    ).resolves.toEqual({
      ok: false,
      committed: true,
      message: 'ledger unavailable',
    });

    expect(calls).toEqual(['persisted', 'ledger']);
  });
});
