import type { ShareResult } from '../services/share/shareService';

export interface ShareNotice {
  tone: 'info' | 'success' | 'error';
  title: string;
  message: string;
}

interface RunReferralShareOptions {
  executeShare(): Promise<ShareResult>;
  setNotice(notice: ShareNotice | null): void;
  setSharing(isSharing: boolean): void;
}

function getShareNotice(result: ShareResult): ShareNotice {
  if (result.status === 'shared') {
    return {
      tone: 'success',
      title: result.channel === 'clipboard' ? 'Invite copied' : 'Share sheet opened',
      message:
        result.channel === 'clipboard'
          ? 'Web Share is unavailable here, so the complete invite was copied to your clipboard.'
          : 'The share action completed successfully.',
    };
  }

  if (result.status === 'cancelled') {
    return {
      tone: 'info',
      title: 'Share cancelled',
      message: 'No success event was recorded.',
    };
  }

  return { tone: 'error', title: 'Share failed', message: result.reason };
}

export async function runReferralShare({
  executeShare,
  setNotice,
  setSharing,
}: RunReferralShareOptions): Promise<void> {
  setNotice(null);
  setSharing(true);

  try {
    setNotice(getShareNotice(await executeShare()));
  } catch {
    setNotice({
      tone: 'error',
      title: 'Share failed',
      message: 'The share action ended unexpectedly. Please try again.',
    });
  } finally {
    setSharing(false);
  }
}
