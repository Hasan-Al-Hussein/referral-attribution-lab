import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { loadProjectEnv } from '@expo/env';

const [platform, operation] = process.argv.slice(2);
const supportedPlatforms = new Set(['android', 'ios']);
const supportedOperations = new Set(['run', 'prebuild']);

loadProjectEnv(process.cwd(), { silent: true });

if (!platform || !supportedPlatforms.has(platform)) {
  throw new Error('Platform must be android or ios.');
}
if (!operation || !supportedOperations.has(operation)) {
  throw new Error('Operation must be run or prebuild.');
}

const require = createRequire(import.meta.url);
const expoCli = require.resolve('expo/bin/cli');
const environment = {
  ...process.env,
  NATIVE_BUILD_PLATFORM: platform,
  NATIVE_SDK_BUILD: '1',
};

function run(args) {
  const result = spawnSync(process.execPath, [expoCli, ...args], {
    env: environment,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Native ${platform} preflight: validating Branch and Firebase configuration.`);
run(['config', '--type', 'public']);

if (operation === 'prebuild') {
  run(['prebuild', '--clean', '--platform', platform, '--no-install']);
} else {
  run([`run:${platform}`]);
}
