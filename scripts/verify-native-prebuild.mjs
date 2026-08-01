import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { loadProjectEnv } from '@expo/env';
import plistModule from '@expo/plist';

// @expo/plist is CommonJS. Node's native ESM interop exposes its API one level
// below the default import, while Expo's TypeScript config loader unwraps it.
const plist = plistModule.default ?? plistModule;

const [platform] = process.argv.slice(2);
const projectRoot = process.cwd();

loadProjectEnv(projectRoot, { silent: true });

const primaryDomain = process.env.EXPO_PUBLIC_BRANCH_DOMAIN;
const alternateDomain = process.env.EXPO_PUBLIC_BRANCH_ALTERNATE_DOMAIN;
const expectedPackage = 'com.hasanalhussein.referrallab';

function fail(message) {
  throw new Error(`Native ${platform} verification failed: ${message}`);
}

function readRequired(relativePath) {
  const filePath = join(projectRoot, relativePath);
  if (!existsSync(filePath)) fail(`missing ${relativePath}`);
  return readFileSync(filePath, 'utf8');
}

function requireText(source, expected, label) {
  if (!source.includes(expected)) fail(`${label} does not contain ${expected}`);
}

function verifyRuntimeConfig(relativePath) {
  const runtimeConfig = JSON.parse(readRequired(relativePath));
  if (runtimeConfig.deferInitForPluginRuntime !== true) {
    fail(`${relativePath} does not defer Branch initialization for the JS subscriber`);
  }
  if (runtimeConfig.checkPasteboardOnInstall !== true) {
    fail(`${relativePath} does not enable iOS NativeLink pasteboard recovery`);
  }
}

if (!primaryDomain) fail('EXPO_PUBLIC_BRANCH_DOMAIN is required');

if (platform === 'android') {
  verifyRuntimeConfig('android/app/src/main/assets/branch.json');
  const manifest = readRequired('android/app/src/main/AndroidManifest.xml');
  const buildGradle = readRequired('android/app/build.gradle');
  const firebaseConfig = JSON.parse(readRequired('android/app/google-services.json'));

  for (const expected of [
    'android:autoVerify="true"',
    `android:host="${primaryDomain}"`,
    'android:scheme="referrallab"',
    'com.android.vending.INSTALL_REFERRER',
    'io.branch.sdk.BranchKey.test',
    'io.branch.sdk.TestMode',
    'android:value="true"',
    'com.google.android.gms.permission.AD_ID" tools:node="remove"',
  ]) {
    requireText(manifest, expected, 'AndroidManifest.xml');
  }
  if (alternateDomain) {
    requireText(manifest, `android:host="${alternateDomain}"`, 'AndroidManifest.xml');
  }
  requireText(buildGradle, `applicationId '${expectedPackage}'`, 'android/app/build.gradle');
  requireText(buildGradle, "apply plugin: 'com.google.gms.google-services'", 'android/app/build.gradle');

  const firebaseMatches = firebaseConfig.client?.some(
    (client) =>
      client.client_info?.android_client_info?.package_name === expectedPackage,
  );
  if (!firebaseMatches) fail('generated google-services.json has the wrong Android package');
} else if (platform === 'ios') {
  const iosRoot = join(projectRoot, 'ios');
  if (!existsSync(iosRoot)) fail('missing generated ios directory');
  const projectDirectory = readdirSync(iosRoot, { withFileTypes: true }).find(
    (entry) => entry.isDirectory() && !entry.name.endsWith('.xcodeproj') && entry.name !== 'Pods',
  );
  if (!projectDirectory) fail('could not locate generated iOS source directory');
  const projectName = projectDirectory.name;

  verifyRuntimeConfig(`ios/${projectName}/Branch.json`);
  const projectFile = readRequired(`ios/${projectName}.xcodeproj/project.pbxproj`);
  const entitlements = plist.parse(
    readRequired(`ios/${projectName}/${projectName}.entitlements`),
  );
  const firebaseConfig = plist.parse(
    readRequired(`ios/${projectName}/GoogleService-Info.plist`),
  );

  requireText(projectFile, 'Branch.json', 'Xcode project');
  const associatedDomains = entitlements['com.apple.developer.associated-domains'];
  if (!Array.isArray(associatedDomains) || !associatedDomains.includes(`applinks:${primaryDomain}`)) {
    fail('iOS entitlements do not contain the primary Branch domain');
  }
  if (
    alternateDomain &&
    (!Array.isArray(associatedDomains) ||
      !associatedDomains.includes(`applinks:${alternateDomain}`))
  ) {
    fail('iOS entitlements do not contain the alternate Branch domain');
  }
  if (firebaseConfig.BUNDLE_ID !== expectedPackage) {
    fail('generated GoogleService-Info.plist has the wrong bundle identifier');
  }
} else {
  fail('platform must be android or ios');
}

console.log(`Native ${platform} generated-project verification passed.`);
