const fs = require('node:fs');
const path = require('node:path');

const {
  IOSConfig,
  withDangerousMod,
  withXcodeProject,
} = require('@expo/config-plugins');

const SOURCE_FILENAME = 'branch.json';
const ANDROID_DESTINATION = path.join('app', 'src', 'main', 'assets', 'branch.json');
const IOS_DESTINATION = 'Branch.json';

function readRuntimeConfig(projectRoot) {
  const sourcePath = path.join(projectRoot, SOURCE_FILENAME);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const parsed = JSON.parse(source);

  if (
    parsed.deferInitForPluginRuntime !== true ||
    parsed.checkPasteboardOnInstall !== true
  ) {
    throw new Error(
      'branch.json must enable deferInitForPluginRuntime and checkPasteboardOnInstall.',
    );
  }

  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function writeRuntimeConfig(destination, contents) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (fs.existsSync(destination) && fs.readFileSync(destination, 'utf8') === contents) {
    return;
  }
  fs.writeFileSync(destination, contents, 'utf8');
}

function withAndroidBranchRuntimeConfig(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const contents = readRuntimeConfig(modConfig.modRequest.projectRoot);
      writeRuntimeConfig(
        path.join(modConfig.modRequest.platformProjectRoot, ANDROID_DESTINATION),
        contents,
      );
      return modConfig;
    },
  ]);
}

function withIosBranchRuntimeConfig(config) {
  config = withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const contents = readRuntimeConfig(modConfig.modRequest.projectRoot);
      writeRuntimeConfig(
        path.join(
          IOSConfig.Paths.getSourceRoot(modConfig.modRequest.projectRoot),
          IOS_DESTINATION,
        ),
        contents,
      );
      return modConfig;
    },
  ]);

  return withXcodeProject(config, (modConfig) => {
    const projectName = IOSConfig.XcodeUtils.getProjectName(
      modConfig.modRequest.projectRoot,
    );
    const resourcePath = `${projectName}/${IOS_DESTINATION}`;

    if (!modConfig.modResults.hasFile(resourcePath)) {
      modConfig.modResults = IOSConfig.XcodeUtils.addResourceFileToGroup({
        filepath: resourcePath,
        groupName: projectName,
        isBuildFile: true,
        project: modConfig.modResults,
        verbose: false,
      });
    }

    return modConfig;
  });
}

function withBranchRuntimeConfig(config) {
  return withIosBranchRuntimeConfig(withAndroidBranchRuntimeConfig(config));
}

module.exports = withBranchRuntimeConfig;
