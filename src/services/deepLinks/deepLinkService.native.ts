import branch, {
  type BranchLinkControlParams,
  type BranchLinkProperties,
} from 'react-native-branch';

import type { DeepLinkService } from './deepLinkService';
import type { RawDeepLinkEvent } from '../../domain/referral';

type ReferralControlParams = BranchLinkControlParams & {
  $deeplink_path: string;
  $ios_nativelink: 'true';
  referral_code: string;
};

export class BranchDeepLinkService implements DeepLinkService {
  readonly mode = 'native' as const;
  private listener: ((event: RawDeepLinkEvent) => void) | undefined;

  async createReferralLink(referralCode: string): Promise<string> {
    const branchUniversalObject = await branch.createBranchUniversalObject(
      `referral/${referralCode}`,
      {
        title: 'Join my Referral Lab',
        contentDescription: 'Open a demo account with my referral code already applied.',
        contentMetadata: {
          customMetadata: { referral_code: referralCode },
        },
      },
    );
    const linkProperties: BranchLinkProperties = {
      feature: 'referral',
      channel: 'in_app_share',
      campaign: 'member_referral',
    };
    const controlParams: ReferralControlParams = {
      $deeplink_path: 'onboarding/referral',
      $ios_nativelink: 'true',
      referral_code: referralCode,
    };

    try {
      const { url } = await branchUniversalObject.generateShortUrl(
        linkProperties,
        controlParams,
      );
      return url;
    } finally {
      branchUniversalObject.release();
    }
  }

  subscribe(listener: (event: RawDeepLinkEvent) => void): () => void {
    this.listener = listener;
    return branch.subscribe({
      onOpenStart: () => undefined,
      onOpenComplete: ({ error, params, uri }) => {
        listener({
          ...(params ? { params } : {}),
          ...(uri ? { uri } : {}),
          ...(error ? { error } : {}),
        });
      },
    });
  }

  simulate(kind: 'direct' | 'deferred' | 'invalid', referralCode: string): void {
    const code = kind === 'invalid' ? 'BAD-CODE' : referralCode;
    this.listener?.({
      uri: `referrallab://onboarding/referral?referral_code=${encodeURIComponent(code)}`,
      params: {
        '+clicked_branch_link': true,
        '+is_first_session': kind === 'deferred',
        '+click_timestamp': Date.now().toString(),
        $deeplink_path: 'onboarding/referral',
        referral_code: code,
        __demo: true,
      },
    });
  }
}

export function createDeepLinkService(): DeepLinkService {
  return new BranchDeepLinkService();
}
