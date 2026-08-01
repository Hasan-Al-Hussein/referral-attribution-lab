import { Share } from 'react-native';

import type { ShareResult, ShareService } from './shareService';

export class NativeShareService implements ShareService {
  async shareReferral(url: string, referralCode: string): Promise<ShareResult> {
    try {
      const result = await Share.share({
        title: 'Join Referral Lab',
        message: `Join my Referral Lab. Your referral code ${referralCode} is already applied.\n${url}`,
        url,
      });
      if (result.action === Share.dismissedAction) return { status: 'cancelled' };
      return { status: 'shared', channel: 'native-share' };
    } catch (error) {
      return { status: 'failed', reason: error instanceof Error ? error.message : 'Share failed' };
    }
  }
}

export function createShareService(): ShareService {
  return new NativeShareService();
}
