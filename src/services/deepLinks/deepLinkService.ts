import type { RawDeepLinkEvent } from '../../domain/referral';

export interface DeepLinkService {
  createReferralLink(referralCode: string): Promise<string>;
  subscribe(listener: (event: RawDeepLinkEvent) => void): () => void;
  simulate(kind: 'direct' | 'deferred' | 'invalid', referralCode: string): void;
  readonly mode: 'native' | 'web-demo';
}

function eventFromUrl(url: string): RawDeepLinkEvent | null {
  try {
    const parsed = new URL(url);
    const referralCode = parsed.searchParams.get('referral_code');
    if (!referralCode) return null;
    return {
      uri: url,
      params: {
        '+clicked_branch_link': true,
        '+is_first_session': parsed.searchParams.get('deferred') === '1',
        '+click_timestamp': parsed.searchParams.get('click_ts') ?? Date.now().toString(),
        $deeplink_path: 'onboarding/referral',
        referral_code: referralCode,
        __demo: true,
      },
    };
  } catch {
    return null;
  }
}

export class WebDemoDeepLinkService implements DeepLinkService {
  readonly mode = 'web-demo' as const;
  private listener: ((event: RawDeepLinkEvent) => void) | undefined;

  async createReferralLink(referralCode: string): Promise<string> {
    const appUrl =
      typeof window === 'undefined'
        ? 'https://demo.invalid/'
        : `${window.location.origin}${window.location.pathname}`;
    return `${appUrl}?referral_code=${encodeURIComponent(referralCode)}&click_ts=${Date.now()}`;
  }

  subscribe(listener: (event: RawDeepLinkEvent) => void): () => void {
    this.listener = listener;
    const handleLocation = () => {
      if (typeof window === 'undefined') return;
      const event = eventFromUrl(window.location.href);
      if (event) listener(event);
    };
    const initialTimer = setTimeout(handleLocation, 0);
    if (typeof window !== 'undefined') window.addEventListener('popstate', handleLocation);

    return () => {
      clearTimeout(initialTimer);
      if (typeof window !== 'undefined') window.removeEventListener('popstate', handleLocation);
      this.listener = undefined;
    };
  }

  simulate(kind: 'direct' | 'deferred' | 'invalid', referralCode: string): void {
    const code = kind === 'invalid' ? 'BAD-CODE' : referralCode;
    this.listener?.({
      uri: `https://referral-lab-demo.invalid/r/${encodeURIComponent(code)}`,
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
  return new WebDemoDeepLinkService();
}
