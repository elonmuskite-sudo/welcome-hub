# Release signing configuration — Nexus Chat

How the Android and iOS release builds are signed, what is already in place, and
the exact steps that require your platform accounts.

App: **Nexus Chat** · `com.nexus.chat.app` · version `1.0` / code `1`.

---

## 1. Android — release signing (configured)

### Keystore

| Item | Value |
| --- | --- |
| Keystore file | `android/app/nexus-release.keystore` (gitignored) |
| Key alias | `nexus-upload` |
| Store type | PKCS12 |
| Key algorithm | RSA 2048-bit |
| Signature algorithm | SHA384withRSA |
| Validity | 20 Oct 2026 → 7 Mar 2054 (10 000 days) |
| Distinguished name | `CN=Nexus Chat, OU=Mobile, O=Nexus Chat, L=London, ST=England, C=GB` |
| SHA-256 fingerprint | `A8:11:DE:F1:5F:F2:A6:DE:C1:CF:91:36:12:EC:C5:2F:94:3E:78:0B:7B:88:4A:3E:3E:44:3F:92:25:80:9B:33` |

### Secrets

Passwords live in `android/key.properties` (gitignored):

```
storeFile=nexus-release.keystore
storeType=PKCS12
storePassword=<48-char random hex>
keyAlias=nexus-upload
keyPassword=<48-char random hex>
```

> **Back up the keystore and this file now.** The passwords are 48-character
> random hex values that were generated on this machine and deliberately **not
> printed anywhere**. If you lose this file you cannot sign updates to the app
> unless you enrolled in **Play App Signing** (recommended — see below). Store
> both in a password manager.

### Gradle wiring (applied)

`android/app/build.gradle` loads `key.properties` and applies it to the release
build type:

```groovy
def releaseKeystorePropertiesFile = rootProject.file("key.properties")
def releaseKeystoreProperties = new Properties()
if (releaseKeystorePropertiesFile.exists()) {
    releaseKeystoreProperties.load(new FileInputStream(releaseKeystorePropertiesFile))
}
...
    signingConfigs {
        release {
            if (releaseKeystorePropertiesFile.exists()) {
                storeFile file(releaseKeystoreProperties['storeFile'])
                storeType releaseKeystoreProperties['storeType'] ?: 'PKCS12'
                storePassword releaseKeystoreProperties['storePassword']
                keyAlias releaseKeystoreProperties['keyAlias']
                keyPassword releaseKeystoreProperties['keyPassword']
            }
        }
    }
    buildTypes {
        release {
            if (releaseKeystorePropertiesFile.exists()) { signingConfig signingConfigs.release }
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android.txt'), 'proguard-rules.pro'
        }
    }
```

The build degrades gracefully: if `key.properties` is absent (for example on CI
without secrets) the release build stays unsigned instead of failing to
configure.

### SDK path

`android/local.properties` (gitignored) points Gradle at the local SDK:

```
sdk.dir=C\:\\Users\\User$\\Downloads\\welcome-hub\\android-sdk
```

Gradle auto-installs the packages this project needs (build-tools 35.0.0,
platform android-36, platform-tools) into `android-sdk/`, which is gitignored.
This directory is used instead of the shared SDK under `%LOCALAPPDATA%` so the
build does not depend on write access to a machine-wide location.

### Platform wiring fixes (applied)

Two generated-file problems prevented the Android project from configuring at
all, and are now fixed:

| File | Fix |
| --- | --- |
| `android/settings.gradle` | Added `apply from: './capacitor.settings.gradle'` and the `:capacitor-cordova-android-plugins` include. Without them Gradle cannot resolve `:capacitor-android` / `:capacitor-cordova-android-plugins` that `android/app/build.gradle` depends on. |
| `android/local.properties` | Created (gitignored) so Gradle can find the SDK. |

### Build the release bundle

```powershell
cd android
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot"
.\gradlew.bat bundleRelease
```

Output: `android/app/build/outputs/bundle/release/app-release.aab` → upload to
Google Play.

### Build result (verified)

```
> Task :app:validateSigningRelease
> Task :app:packageReleaseBundle
> Task :app:signReleaseBundle
> Task :app:bundleRelease

BUILD SUCCESSFUL in 11m 19s
111 actionable tasks: 111 executed
```

Artifact: `android/app/build/outputs/bundle/release/app-release.aab`, 6,905,946
bytes. Its embedded signing certificate was checked with `keytool -printcert
-jarfile` and matches this keystore exactly:

```
Owner: CN=Nexus Chat, OU=Mobile, O=Nexus Chat, L=London, ST=England, C=GB
SHA256: A8:11:DE:F1:5F:F2:A6:DE:C1:CF:91:36:12:EC:C5:2F:94:3E:78:0B:7B:88:4A:3E:3E:44:3F:92:25:80:9B:33
Signature algorithm name: SHA384withRSA
Subject Public Key Algorithm: 2048-bit RSA key
```

Verify the signing of a built artifact at any time:

```powershell
& "$env:JAVA_HOME\bin\keytool.exe" -printcert -jarfile app\build\outputs\bundle\release\app-release.aab
```

### Play App Signing (recommended)

Enroll in **Play App Signing** in Play Console → Release → Setup → App signing.
Google then holds the app signing key and this upload key only needs to sign
uploads. This is what makes a lost upload keystore recoverable.

### Latest-requirements check

| Requirement | Status |
| --- | --- |
| `targetSdkVersion` 36 (Android 16) — Play deadline 31 Aug 2026 | ✅ `variables.gradle` |
| `compileSdkVersion` 36, AGP 8.9.1, Gradle 8.11.1 | ✅ |
| R8/minify off, ProGuard rules present | ✅ (fine for a WebView app) |
| Upload signed with an RSA ≥ 2048-bit key | ✅ |
| Keystore validity past 2033 (Play minimum) | ✅ (2054) |

---

## 2. iOS — distribution signing (requires your Apple account)

Everything that can be prepared locally is prepared. Creating the certificate and
provisioning profile requires signing in to your **Apple Developer Program**
account, which cannot be done from this machine.

### Project facts

| Item | Value |
| --- | --- |
| Bundle identifier | `com.nexus.chat.app` |
| Deployment target | iOS 13.0 |
| Marketing version / build | 1.0 / 1 |
| Signing style | Automatic (`CODE_SIGN_STYLE = Automatic`) |
| Workspace | `ios/App/App.xcworkspace` |
| Export compliance | `ITSAppUsesNonExemptEncryption = false` |

### Steps (in your Apple Developer account / Xcode)

1. **App ID.** Certificates, Identifiers & Profiles → Identifiers → register an
   App ID with explicit bundle ID `com.nexus.chat.app`. Enable **Push
   Notifications** only if you ship push (not required for the base app).
2. **Distribution certificate.** Create an **Apple Distribution** certificate
   (or let Xcode manage it) and install it in the login keychain.
3. **Provisioning profile.** Create an **App Store Distribution** profile for
   App ID `com.nexus.chat.app`, tied to the distribution certificate.
4. **Xcode.** Open `ios/App/App.xcworkspace`, select the **App** target → Signing
   & Capabilities, set your **Team**, and either keep **Automatically manage
   signing** or switch to manual and pick the profile above. The capability set
   must match the App ID (no extra entitlements unless deliberately added).
5. **Archive.** Product → Archive, then Distribute App → App Store Connect.
6. **Verify the archive is signed for distribution, not development.** A build
   signed with a development identity still installs and still looks signed
   locally, but App Store Connect rejects it with
   `ITMS-90034 Missing or invalid signature`. After export, check the authority:

   ```powershell
   codesign -dv --verbose=4 build/ipa/Payload/App.app
   # Authority=Apple Distribution  <- required
   # Authority=Apple Development   <- wrong: the archive will be rejected
   ```

### CLI archive + export (optional)

```powershell
xcodebuild -workspace ios/App/App.xcworkspace -scheme App `
  -configuration Release -archivePath build/App.xcarchive archive

xcodebuild -exportArchive -archivePath build/App.xcarchive `
  -exportOptionsPlist ios/exportOptions.plist -exportPath build/ipa
```

`ios/exportOptions.plist` template (create it when you have your Team ID):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>YOUR_TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>compileBitcode</key><false/>
</dict>
</plist>
```

### Fixes applied for latest-requirements compatibility

| Change | Reason |
| --- | --- |
| `UIRequiredDeviceCapabilities`: `armv7` → `arm64` | App Store builds are 64-bit only; the old Capacitor-template `armv7` capability is legacy and can affect device eligibility. |
| `ITSAppUsesNonExemptEncryption = false` (kept) | The app uses only OS-provided standard cryptography (TLS, AES-256-GCM, ECDH P-256), which is exempt; this avoids an export-compliance prompt per build. |
| `CODE_SIGN_IDENTITY` in the project-level Debug config: `"iPhone Developer"` → `"Apple Development"` | `iPhone Developer` is the pre-Xcode-11 name for the development identity. |
| `CODE_SIGN_IDENTITY` removed from the project-level Release config | It pinned a *development* identity onto the Release archive. The project builds `Automatic` (`CODE_SIGN_STYLE = Automatic` on the App target), so leaving the identity unset lets Xcode take `Apple Distribution` from the provisioning profile. A development-signed archive is accepted locally and then rejected by App Store Connect with `ITMS-90034 Missing or invalid signature`. |

### Things you must confirm in App Store Connect

- **Encryption / export compliance:** answer "No" to
  `ITSAppUsesNonExemptEncryption` questions — the app uses exempt encryption only
  and does not implement a proprietary crypto algorithm.
- **Age rating:** 12+ (user-generated content with reporting and blocking).
- **Available devices:** iPhone + iPad (the app ships both orientations).

---

## 3. Signing checklist

| # | Item | Status |
| --- | --- | --- |
| 1 | Android upload keystore generated, alias `nexus-upload` | ✅ |
| 2 | `key.properties` created and gitignored with strong random passwords | ✅ |
| 3 | `.gitignore` blocks `*.keystore`, `*.jks`, `android/key.properties` | ✅ |
| 4 | `signingConfigs.release` wired into `android/app/build.gradle` | ✅ |
| 5 | Release bundle compiles and is signed | ✅ verified (AAB, fingerprint matches) |
| 6 | Play App Signing enrolled | **manual — Play Console** |
| 7 | iOS App ID / distribution certificate / provisioning profile | **manual — Apple account** |
| 8 | `exportOptions.plist` created with real Team ID | **manual** |
| 9 | Keystore + passwords backed up in a password manager | **manual — do this now** |
