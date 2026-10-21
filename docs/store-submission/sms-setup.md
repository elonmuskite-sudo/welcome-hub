# Twilio SMS setup and verification

SMS is an optional, consent-based channel. Email sign-in remains unchanged.
Users must first verify their phone in **Settings → Notifications**, then
separately opt in to transactional messages. The app sends sign-in security
alerts and identity-review outcomes only; it does not send marketing messages.
Phone verification codes are sent by Supabase Auth through its configured
Twilio provider.

## Configure Twilio

1. Create a Twilio Messaging Service and attach an eligible sender for every
   country where the app will be tested or offered.
2. Complete applicable sender and destination-country requirements before
   sending production traffic. This includes US A2P 10DLC brand/campaign
   registration or toll-free verification when applicable, and any local
   sender registration, consent, and template rules.
3. Enable Twilio Advanced Opt-Out for the Messaging Service so STOP/HELP
   keywords are handled by Twilio. Keep the app's in-settings opt-out available
   as well. Never treat a provider rejection as a successful delivery.
4. Restrict the Twilio API key/account to the minimum messaging permissions
   practical for the account. Do not put Twilio credentials in browser-visible
   `VITE_` variables or commit them.

## Configure phone verification in Supabase Auth

In the production Supabase project's Auth phone/SMS provider settings, enable
the SMS provider and enter the Twilio Account SID, Auth Token, and Messaging
Service SID. Use a verification-code template that contains Supabase's code
placeholder. Keep email sign-in enabled; do not expose phone sign-in as a
replacement login method. Phone updates use Supabase Auth's `phone_change` OTP
and are not considered verified until the user submits the received code.

## Configure transactional notifications

Add these server-only values to the Vercel server environment and the Supabase
Edge Function secrets for every environment where notifications should send:

```text
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_MESSAGING_SERVICE_SID
```

The application uses these secrets only from server runtimes. Both system
notification implementations (the `system-email` Edge Function and its Vercel
API fallback) must be deployed with the current code. The browser sends only
the signed-in request; the server resolves and verifies the recipient phone,
consent, role, MFA assurance, and review status. A client-supplied recipient
number is never used.

## Staging acceptance checks

Use only consenting, controlled test numbers and a Twilio test/staging account
first. Verify:

1. Phone verification sends an OTP to the entered E.164 number; an invalid or
   expired code does not verify it.
2. The SMS consent control cannot be enabled before phone verification. Opting
   out prevents subsequent system SMS while email notifications continue.
3. A normal sign-in produces one security SMS only for a verified, opted-in
   number. An admin sign-in alert is permitted only after the server verifies
   AAL2.
4. An approved/rejected identity review notifies only the reviewed account's
   verified, opted-in number. Reviewer notes and identity-document details are
   not included in the SMS.
5. Twilio errors, rate limits, STOP suppression, delivery status, message
   rendering, and the relevant carrier/sender registration are checked in the
   Twilio console on recipient devices. Confirm STOP suppresses further
   delivery and test the in-app opt-out independently.
6. Check actual message segmentation in the Twilio console and device display.
   Current templates are ASCII and at most 160 characters; carrier behavior and
   encoding still require live validation.

Do not use real user numbers for test traffic. Record the test date, region,
sender type, carrier, device/OS, Twilio message status, and observed rendering
without recording OTP values or full phone numbers in the release report.

Live delivery is **not verified** until Twilio and Supabase Auth are configured,
the current Edge Function/API code is deployed, and these checks pass. Follow
the release status in [internal-validation.md](./internal-validation.md).
