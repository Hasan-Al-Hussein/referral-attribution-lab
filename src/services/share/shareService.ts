import * as Clipboard from 'expo-clipboard';

export type ShareResult =
  | { status: 'shared'; channel: 'web-share' | 'clipboard' | 'native-share' }
  | { status: 'cancelled' }
  | { status: 'failed'; reason: string };

export interface ShareService {
  shareReferral(url: string, referralCode: string): Promise<ShareResult>;
}

interface ShareCapableNavigator {
  share?: (data: ShareData) => Promise<void>;
}

export class WebShareService implements ShareService {
  async shareReferral(url: string, referralCode: string): Promise<ShareResult> {
    const message = `Join my Referral Lab. Your referral code ${referralCode} is already applied.`;
    const webNavigator = typeof navigator === 'undefined' ? undefined : (navigator as ShareCapableNavigator);
    if (webNavigator?.share) {
      try {
        await webNavigator.share({ title: 'Join Referral Lab', text: message, url });
        return { status: 'shared', channel: 'web-share' };
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return { status: 'cancelled' };
        return { status: 'failed', reason: error instanceof Error ? error.message : 'Share failed' };
      }
    }

    try {
      await Clipboard.setStringAsync(`${message}\n${url}`);
      return { status: 'shared', channel: 'clipboard' };
    } catch (error) {
      return { status: 'failed', reason: error instanceof Error ? error.message : 'Copy failed' };
    }
  }
}

export function createShareService(): ShareService {
  return new WebShareService();
}
