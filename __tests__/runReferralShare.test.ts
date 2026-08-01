import { describe, expect, it, jest } from '@jest/globals';

import {
  runReferralShare,
  type ShareNotice,
} from '../src/application/runReferralShare';

describe('referral share UI orchestration', () => {
  it.each([
    {
      result: { status: 'shared', channel: 'clipboard' } as const,
      expected: {
        tone: 'success',
        title: 'Invite copied',
        message: 'Web Share is unavailable here, so the complete invite was copied to your clipboard.',
      },
    },
    {
      result: { status: 'shared', channel: 'web-share' } as const,
      expected: {
        tone: 'success',
        title: 'Share sheet opened',
        message: 'The share action completed successfully.',
      },
    },
    {
      result: { status: 'shared', channel: 'native-share' } as const,
      expected: {
        tone: 'success',
        title: 'Share sheet opened',
        message: 'The share action completed successfully.',
      },
    },
    {
      result: { status: 'cancelled' } as const,
      expected: {
        tone: 'info',
        title: 'Share cancelled',
        message: 'No success event was recorded.',
      },
    },
    {
      result: { status: 'failed', reason: 'Clipboard unavailable' } as const,
      expected: {
        tone: 'error',
        title: 'Share failed',
        message: 'Clipboard unavailable',
      },
    },
  ])('preserves the $result.status result notice and settles sharing', async ({ result, expected }) => {
    const notices: (ShareNotice | null)[] = [];
    const sharingStates: boolean[] = [];

    await runReferralShare({
      executeShare: async () => result,
      setNotice: (notice) => notices.push(notice),
      setSharing: (isSharing) => sharingStates.push(isSharing),
    });

    expect(notices).toEqual([null, expected]);
    expect(sharingStates).toEqual([true, false]);
  });

  it('converts an unexpected rejection into a safe notice and always clears sharing', async () => {
    const notices: (ShareNotice | null)[] = [];
    const sharingStates: boolean[] = [];
    const executeShare = jest.fn<() => Promise<never>>().mockRejectedValue(new Error('provider secret'));

    await expect(
      runReferralShare({
        executeShare,
        setNotice: (notice) => notices.push(notice),
        setSharing: (isSharing) => sharingStates.push(isSharing),
      }),
    ).resolves.toBeUndefined();

    expect(notices).toEqual([
      null,
      {
        tone: 'error',
        title: 'Share failed',
        message: 'The share action ended unexpectedly. Please try again.',
      },
    ]);
    expect(sharingStates).toEqual([true, false]);
  });
});
