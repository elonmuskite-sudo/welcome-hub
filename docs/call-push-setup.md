# Background call notifications

Incoming calls use Supabase Realtime while the app is open. Web Push and Firebase Cloud Messaging provide an alert that can reopen the call in the web/PWA or Capacitor app after the realtime connection has closed. The recipient must open the alert before the caller's 45-second ring timeout expires; the alert does not keep a microphone session running in the background.

## Database

Apply the new `call_push_subscriptions` migration to the production Supabase project using the project's normal migration workflow. Then run `npm run db:verify`. Push endpoints are private: authenticated users can manage only their own registrations; server-side delivery reads destinations only after conversation membership is verified.

## Web and installed PWA

1. Generate a VAPID key pair with `npx web-push generate-vapid-keys`.
2. Set these Vercel environment variables for every environment that should support push:
   - `VITE_WEB_PUSH_PUBLIC_KEY`: VAPID public key.
   - `WEB_PUSH_VAPID_PUBLIC_KEY`: the same public key.
   - `WEB_PUSH_VAPID_PRIVATE_KEY`: VAPID private key (server-only secret).
   - `WEB_PUSH_VAPID_SUBJECT`: a `mailto:` contact or HTTPS URL.
3. Redeploy so the public key is included in the web client. Do not put the private key in a `VITE_` variable or commit it.
4. On each browser/device, sign in, open Settings → Notifications, and choose **Enable call alerts**. The browser must permit notifications and background push. Users must repeat this on each device/browser profile.

## Android and iOS Capacitor apps

1. Create/configure a Firebase project and register the Android app (`com.nexus.chat.app`) and the iOS app using the bundle identifier configured in Xcode.
2. Add the Firebase Android configuration file to the native Android app and the iOS configuration plist to the Xcode app target. Keep both files out of source control unless the project intentionally manages public Firebase client configuration there.
3. Enable the Push Notifications capability for the iOS app target in Xcode, then configure the APNs authentication key and team details in Firebase project settings.
4. Add `FIREBASE_SERVICE_ACCOUNT_JSON` as a server-only Vercel environment variable containing the Firebase service-account JSON as a single-line JSON value. Never use a service-account key in a `VITE_` variable or mobile client.
5. Run `npx cap sync`, build and install the native apps, then enable call alerts in Settings → Notifications on each device.

The Vercel environment sync allowlist treats `FIREBASE_SERVICE_ACCOUNT_JSON` as an encrypted server-only value. Verify it is configured for the deployment target; the environment validator rejects malformed service-account JSON. The Firebase client files (`google-services.json` and `GoogleService-Info.plist`) are separate from this server secret and must be obtained from the Firebase console for the matching native app IDs.

The app's push notification opens the conversation and reconnects to the ephemeral Realtime call channel so the user can answer. This implementation does not provide a native CallKit/Android ConnectionService full-screen call UI while the app is terminated. iOS/Android may also defer or suppress notifications according to OS notification, battery, focus, and network settings.

## Voice and video call relay

Voice and video use browser WebRTC media; there is no per-call API key or media-server account. STUN may connect directly, but reliable calls on restrictive mobile/NAT networks need TURN. To provision the current Metered Open Relay integration:

1. Create an account at [Metered Open Relay](https://dashboard.metered.ca/signup?tool=turnserver), then copy the API key and the app subdomain/name from its dashboard.
2. Put them in the ignored local `.env.local` as `METERED_API_KEY` and `METERED_APP_NAME` (never use `VITE_` for the Metered API key). The helper reads `.env.local` or shell variables only, not `.env`.
3. Run `npm run turn:credentials -- --write`. This writes the TURN URLs and browser-required temporary relay username/credential to `.env.local` without printing credential values.
4. Add `VITE_STUN_URL`, `VITE_TURN_URL`, `VITE_TURN_USERNAME`, and `VITE_TURN_CREDENTIAL` to the Vercel project for each environment, then redeploy. WebRTC must receive relay credentials in the client, so these credentials are visible to signed-in browsers; use expiring provider-issued credentials and rotate them. Do not copy the Metered API key to Vercel/browser variables.
5. Test a voice call and video call between separate networks (for example Wi-Fi and cellular) and verify camera permission, mute, camera-off, switch-camera, hangup, and reconnect behavior.

The video call UI uses camera and microphone permission through `getUserMedia`. If calls must work in the background or use managed recording/large group calls, that requires a separate media platform and is not included.

## Verification

- `npm run db:verify` confirms the subscription table and owner-only RLS policy after the migration is applied.
- Test browser push with the app fully closed, and native push with the app backgrounded and terminated.
- Confirm notification permission, VAPID/Firebase configuration, and APNs setup before diagnosing a missing call alert.
