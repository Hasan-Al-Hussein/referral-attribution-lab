# Native provider proof runbook

This runbook turns the repository implementation into demo-grade Android/iOS evidence after provider credentials and devices are available. It keeps three claims separate:

1. **Generated/compiled native structure** ; CI proves the Branch/Firebase modules, manifests, entitlements, runtime configuration, and Android debug compilation.
2. **Real installed-app provider behavior** ; a configured signed build and physical device prove Branch direct/cold/warm callbacks and Firebase DebugView delivery.
3. **Production-equivalent deferred install** ; Play internal testing or TestFlight proves app absent → link click → store install → first launch attribution.

The web demo app is not evidence for levels 2 or 3.

## Required inputs

- A Branch test app with `key_test_...`, primary and alternate test link domains, package/bundle identifiers, safe fallbacks, and dashboard access.
- A Firebase project with Android and/or iOS apps registered as `com.hasanalhussein.referrallab`.
- An Expo account/project for EAS builds, or a complete local Android/macOS build toolchain.
- A physical Android/iOS device for provider proof.
- Play Console internal testing or App Store Connect/TestFlight access for store-mediated proof.

Branch and Firebase identifiers embedded in mobile config files are not server secrets, but they must belong to projects the operator controls. Never commit Branch secrets, service-account keys, signing passwords, or store API keys.

## Configure once

Copy `.env.example` to `.env.local`, set `NATIVE_SDK_BUILD=1`, and add the real test values. The native wrappers fail before Prebuild if:

- a Branch key has the wrong test/live prefix;
- a Branch domain contains a scheme, path, port, or whitespace;
- primary and alternate domains are the same;
- a Firebase file is missing, malformed, or registered to a different app ID.

The build packages `branch.json` with `deferInitForPluginRuntime=true` and `checkPasteboardOnInstall=true`. Generated links include `$ios_nativelink=true`. On iOS, enable NativeLink in Branch and account for the system pasteboard notice in the review recording.

## Local native generation

```bash
npm run native:prebuild:android
npm run native:verify:android
```

On macOS:

```bash
npm run native:prebuild:ios
npm run native:verify:ios
```

Use `npm run android` or `npm run ios` to preflight and launch a configured native build. Expo Go is not supported because Branch and React Native Firebase require custom native modules.

## EAS builds

The EAS CLI is pinned to `21.4.0`.

```bash
npx eas-cli@21.4.0 login
npx eas-cli@21.4.0 init
npx eas-cli@21.4.0 build --platform android --profile preview
```

`preview` creates a sideloadable Branch-test APK. It is appropriate for UI, SDK startup, native sharing, and installed-app direct/cold/warm evidence.

For a store-mediated test build:

```bash
npx eas-cli@21.4.0 build --platform android --profile store-test
npx eas-cli@21.4.0 build --platform ios --profile store-test
```

`store-test` uses the EAS `preview` credential environment, Branch test mode, store distribution, and remote auto-incremented versions. Upload the Android AAB to Play internal testing or the iOS archive to TestFlight.

## Android installed-app proof

Set the real test domain and referral URL:

```powershell
$packageName = 'com.hasanalhussein.referrallab'
$branchDomain = 'your-app.test-app.link'
$referralUrl = 'https://your-app.test-app.link/REAL_BRANCH_PATH'
```

Enable Firebase DebugView and reset App Link verification:

```powershell
adb shell setprop debug.firebase.analytics.app $packageName
adb shell pm set-app-links --package $packageName 0 all
adb shell pm verify-app-links --re-verify $packageName
adb shell pm get-app-links $packageName
```

Pass criteria:

- the Branch domains report `verified`;
- the certificate SHA-256 in Branch matches the installed signing certificate;
- opening the real Branch URL launches the app without a chooser;
- the exact referral code is visible and locked on onboarding;
- Branch Liveview records the open/install;
- Firebase DebugView shows the required event with the same `referral_code` and `platform=android`.

Exercise both states:

```powershell
adb shell am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d $referralUrl
adb shell am force-stop $packageName
adb shell am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d $referralUrl
```

The first command proves warm/background or installed-app routing depending on current state. The force-stop sequence proves cold-start buffering and navigation.

Disable DebugView after testing:

```powershell
adb shell setprop debug.firebase.analytics.app .none.
```

## Android store-mediated deferred proof

1. Publish the `store-test` AAB to a Play internal track and opt the device into that track.
2. Put the Play App Signing SHA-256 fingerprint in Branch; it can differ from a local upload/debug key.
3. Confirm the Branch dashboard fallback points to the internal Play listing.
4. Uninstall the app and clear the browser/Branch test state as recommended by Branch.
5. Create a fresh referral in the referrer's installed build and share its real Branch HTTPS link.
6. On the invitee device with the app absent, tap the link and install only from the Play internal listing reached by that link.
7. Launch once. Do not tap the link again after install.

Pass criteria:

- Branch returns `+clicked_branch_link=true` and `+is_first_session=true` on first launch;
- onboarding opens automatically with the original code pre-applied;
- `referral_link_clicked`, `referral_signup_started`, and `referral_signup_completed` carry that code and `platform=android` in DebugView;
- the referrer device emitted `referral_link_generated` and `referral_link_shared` for the same code;
- replaying the same callback does not duplicate accepted milestones.

## iOS proof

Use a physical iOS 15+ device. Confirm the Branch AASA response, Apple Team ID, bundle ID, Associated Domains entitlement, and signed build all agree. Enable Firebase DebugView with the Xcode launch argument `-FIRDebugEnabled` and disable it later with `-FIRDebugDisabled`.

For installed-app proof, test a Branch Universal Link with the app backgrounded and force-quit. For a developer-build NativeLink test, follow Branch's iOS procedure: remove the app, open the link through Safari/Deepview, allow the link to be copied, install/launch the development build, and verify the recovered referral. Label that evidence as a **developer-build NativeLink test**.

For production-equivalent evidence, install the `store-test` build through TestFlight after the app-absent click and capture the first-session callback. A developer/Xcode install is not a TestFlight proof.

## Failure-path evidence

Capture at least these cases on one native platform:

- share sheet dismissed: no `referral_link_shared` success event;
- airplane mode/provider timeout: retryable error and no fabricated link/click success;
- invalid or wrong-destination callback: no onboarding navigation;
- duplicate callback: one accepted click milestone;
- signup rejection using the documented `+fail` address: retry remains available;
- ordinary launch with no Branch click: no stale referral route;
- reset/restart: fresh journey state and no old code.

## Evidence packet

Submit one folder or unlisted video containing:

- commit SHA and EAS/build version;
- Branch Link Validator and Liveview screenshots;
- App Link/AASA verification output;
- direct warm and cold routing;
- store-mediated deferred first launch, if store access exists;
- Firebase DebugView for all five required events and their code/platform parameters;
- one failure and one replay case;
- a short note distinguishing compiled structure, provider proof, and store proof.

Official references:

- Branch Expo integration: https://help.branch.io/developer-hub/docs/react-native-expo-integration
- Branch Android testing: https://help.branch.io/developer-hub/docs/android-testing
- Branch iOS testing: https://help.branch.io/developer-hub/docs/ios-testing
- Firebase DebugView: https://firebase.google.com/docs/analytics/debugview
- Android App Link verification: https://developer.android.com/training/app-links/verify-applinks
- Expo internal distribution: https://docs.expo.dev/build/internal-distribution/
