import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import plist from '@expo/plist';

import type { ConfigContext, ExpoConfig } from 'expo/config';

const ANDROID_PACKAGE = 'com.hasanalhussein.referrallab';
const IOS_BUNDLE_IDENTIFIER = 'com.hasanalhussein.referrallab';
const BRANCH_DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

type BranchEnvironment = 'test' | 'live';

interface BranchPluginCredentials {
  apiKey: string;
  testApiKey?: string;
  enableTestEnvironment: boolean;
  environment: BranchEnvironment;
}

function resolveBranchDomain(value: string | undefined, variableName: string) {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (value !== value.trim() || !BRANCH_DOMAIN_PATTERN.test(normalized)) {
    throw new Error(`${variableName} must be a hostname only, without a scheme, path, or port.`);
  }
  return normalized;
}

function requireReadableFile(filePath: string | undefined, variableName: string) {
  if (!filePath) {
    throw new Error(`${variableName} must point to a readable configuration file.`);
  }
  const resolvedPath = resolve(process.cwd(), filePath);
  if (!existsSync(resolvedPath)) {
    throw new Error(`${variableName} file was not found at ${resolvedPath}.`);
  }
  return resolvedPath;
}

function validateAndroidFirebaseConfig(filePath: string | undefined) {
  const resolvedPath = requireReadableFile(filePath, 'GOOGLE_SERVICES_JSON');
  let parsed: {
    client?: { client_info?: { android_client_info?: { package_name?: string } } }[];
  };
  try {
    parsed = JSON.parse(readFileSync(resolvedPath, 'utf8'));
  } catch {
    throw new Error('GOOGLE_SERVICES_JSON must contain valid JSON.');
  }
  const matchesPackage = parsed.client?.some(
    (client) =>
      client.client_info?.android_client_info?.package_name === ANDROID_PACKAGE,
  );
  if (!matchesPackage) {
    throw new Error(`GOOGLE_SERVICES_JSON must register Android package ${ANDROID_PACKAGE}.`);
  }
}

function validateIosFirebaseConfig(filePath: string | undefined) {
  const resolvedPath = requireReadableFile(filePath, 'GOOGLE_SERVICES_PLIST');
  let parsed: Record<string, unknown>;
  try {
    parsed = plist.parse(readFileSync(resolvedPath, 'utf8'));
  } catch {
    throw new Error('GOOGLE_SERVICES_PLIST must contain a valid property list.');
  }
  if (parsed.BUNDLE_ID !== IOS_BUNDLE_IDENTIFIER) {
    throw new Error(
      `GOOGLE_SERVICES_PLIST must register iOS bundle ${IOS_BUNDLE_IDENTIFIER}.`,
    );
  }
}

function hasBranchPrefix(value: string | undefined, environment: BranchEnvironment) {
  const prefix = `key_${environment}_`;
  return value?.startsWith(prefix) === true && value.length > prefix.length;
}

function requireBranchPrefix(
  value: string | undefined,
  environment: BranchEnvironment,
  variableName: string,
) {
  if (!hasBranchPrefix(value, environment)) {
    throw new Error(
      `${variableName} must start with key_${environment}_. The identifier suffix cannot be empty.`,
    );
  }
  return value as string;
}

function resolveBranchCredentials(): BranchPluginCredentials {
  const legacyKey = process.env.EXPO_PUBLIC_BRANCH_KEY;
  const configuredTestKey = process.env.EXPO_PUBLIC_BRANCH_TEST_KEY;
  const configuredLiveKey = process.env.EXPO_PUBLIC_BRANCH_LIVE_KEY;
  const requestedEnvironment = process.env.BRANCH_ENVIRONMENT;

  if (legacyKey && !hasBranchPrefix(legacyKey, 'test') && !hasBranchPrefix(legacyKey, 'live')) {
    throw new Error('EXPO_PUBLIC_BRANCH_KEY must start with key_test_ or key_live_.');
  }
  if (configuredTestKey) {
    requireBranchPrefix(configuredTestKey, 'test', 'EXPO_PUBLIC_BRANCH_TEST_KEY');
  }
  if (configuredLiveKey) {
    requireBranchPrefix(configuredLiveKey, 'live', 'EXPO_PUBLIC_BRANCH_LIVE_KEY');
  }

  const environment =
    requestedEnvironment ??
    (configuredTestKey || hasBranchPrefix(legacyKey, 'test') ? 'test' : 'live');
  if (environment !== 'test' && environment !== 'live') {
    throw new Error('BRANCH_ENVIRONMENT must be test or live.');
  }

  if (environment === 'test') {
    const testApiKey = requireBranchPrefix(
      configuredTestKey ?? (hasBranchPrefix(legacyKey, 'test') ? legacyKey : undefined),
      'test',
      'EXPO_PUBLIC_BRANCH_TEST_KEY (or legacy EXPO_PUBLIC_BRANCH_KEY)',
    );
    const apiKey =
      configuredLiveKey ??
      (hasBranchPrefix(legacyKey, 'live') ? legacyKey : undefined) ??
      testApiKey;

    return { apiKey, testApiKey, enableTestEnvironment: true, environment };
  }

  const apiKey = requireBranchPrefix(
    configuredLiveKey ?? legacyKey,
    'live',
    'EXPO_PUBLIC_BRANCH_LIVE_KEY (or legacy EXPO_PUBLIC_BRANCH_KEY)',
  );
  return { apiKey, enableTestEnvironment: false, environment };
}

export default ({ config }: ConfigContext) => {
  const branchDomain = resolveBranchDomain(
    process.env.EXPO_PUBLIC_BRANCH_DOMAIN,
    'EXPO_PUBLIC_BRANCH_DOMAIN',
  );
  const branchAlternateDomain = resolveBranchDomain(
    process.env.EXPO_PUBLIC_BRANCH_ALTERNATE_DOMAIN,
    'EXPO_PUBLIC_BRANCH_ALTERNATE_DOMAIN',
  );
  const nativeSdkBuild = process.env.NATIVE_SDK_BUILD === '1';
  const nativeBuildPlatform =
    process.env.EAS_BUILD_PLATFORM ?? process.env.NATIVE_BUILD_PLATFORM ?? 'all';
  const easBuildWorker = process.env.EAS_BUILD === 'true';
  const googleServicesJson =
    process.env.GOOGLE_SERVICES_JSON ??
    (nativeSdkBuild && !easBuildWorker ? './google-services.json' : undefined);
  const googleServicesPlist =
    process.env.GOOGLE_SERVICES_PLIST ??
    (nativeSdkBuild && !easBuildWorker ? './GoogleService-Info.plist' : undefined);
  const webBaseUrl = process.env.EXPO_PUBLIC_BASE_URL;
  const branchDomains = [branchDomain, branchAlternateDomain].filter(
    (domain): domain is string => Boolean(domain),
  );
  const plugins: NonNullable<ExpoConfig['plugins']> = ['expo-font'];
  const buildsAndroid = nativeBuildPlatform === 'android' || nativeBuildPlatform === 'all';
  const buildsIos = nativeBuildPlatform === 'ios' || nativeBuildPlatform === 'all';

  if (nativeSdkBuild && !['android', 'ios', 'all'].includes(nativeBuildPlatform)) {
    throw new Error(
      'NATIVE_BUILD_PLATFORM/EAS_BUILD_PLATFORM must be android, ios, or all.',
    );
  }

  if (nativeSdkBuild && !branchDomain) {
    throw new Error(
      'NATIVE_SDK_BUILD=1 requires EXPO_PUBLIC_BRANCH_DOMAIN.',
    );
  }
  if (
    nativeSdkBuild &&
    branchDomain &&
    branchAlternateDomain === branchDomain
  ) {
    throw new Error(
      'EXPO_PUBLIC_BRANCH_ALTERNATE_DOMAIN must differ from EXPO_PUBLIC_BRANCH_DOMAIN.',
    );
  }
  if (nativeSdkBuild && buildsAndroid) {
    validateAndroidFirebaseConfig(googleServicesJson);
  }
  if (nativeSdkBuild && buildsIos) {
    validateIosFirebaseConfig(googleServicesPlist);
  }
  const branchCredentials = nativeSdkBuild ? resolveBranchCredentials() : undefined;

  if (nativeSdkBuild && branchCredentials && branchDomain) {
    plugins.push([
      '@config-plugins/react-native-branch',
      {
        apiKey: branchCredentials.apiKey,
        ...(branchCredentials.testApiKey
          ? { testApiKey: branchCredentials.testApiKey }
          : {}),
        enableTestEnvironment: branchCredentials.enableTestEnvironment,
        iosAppDomain: branchDomain,
        iosUniversalLinkDomains: branchDomains,
      },
    ]);
    plugins.push('./plugins/withBranchRuntimeConfig');
  }

  if (nativeSdkBuild) {
    plugins.push('@react-native-firebase/app');
    plugins.push('@react-native-firebase/analytics');
    plugins.push([
      'expo-build-properties',
      {
        ios: {
          useFrameworks: 'static',
          forceStaticLinking: ['RNFBApp', 'RNFBAnalytics'],
        },
      },
    ]);
  }

  return {
    ...config,
    name: 'Referral Attribution Lab',
    slug: 'referral-attribution-lab',
    version: '1.0.0',
    orientation: 'default',
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    scheme: 'referrallab',
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#D9EFEC',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: IOS_BUNDLE_IDENTIFIER,
      googleServicesFile: nativeSdkBuild && buildsIos ? googleServicesPlist : undefined,
      associatedDomains: branchDomains.map((domain) => `applinks:${domain}`),
    },
    android: {
      package: ANDROID_PACKAGE,
      googleServicesFile:
        nativeSdkBuild && buildsAndroid ? googleServicesJson : undefined,
      permissions: [
        'com.android.vending.INSTALL_REFERRER',
      ],
      blockedPermissions: ['com.google.android.gms.permission.AD_ID'],
      intentFilters: branchDomains.map((domain) => ({
        action: 'VIEW',
        autoVerify: true,
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'https', host: domain, pathPrefix: '/' }],
      })),
    },
    web: {
      bundler: 'metro',
      output: 'single',
      favicon: './assets/favicon.png',
    },
    plugins,
    experiments: {
      typedRoutes: false,
      ...(webBaseUrl ? { baseUrl: webBaseUrl } : {}),
    },
    extra: {
      nativeSdkBuild,
      nativeBuildPlatform,
      easBuildWorker,
      branchConfigured: Boolean(branchCredentials && branchDomain),
      branchEnvironment: branchCredentials?.environment ?? 'not-configured',
      firebaseConfigured: Boolean(
        nativeSdkBuild &&
          (!buildsAndroid || googleServicesJson) &&
          (!buildsIos || googleServicesPlist),
      ),
      firebaseCredentialSource:
        process.env.GOOGLE_SERVICES_JSON || process.env.GOOGLE_SERVICES_PLIST
          ? 'environment-file-path'
          : nativeSdkBuild
            ? 'local-ignored-file-fallback'
            : 'not-configured',
      eas: {
        projectId: process.env.EAS_PROJECT_ID,
      },
    },
  };
};
