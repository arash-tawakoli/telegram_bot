# ImmoScout24 Callback Helper (iOS)

Purpose: complete the existing ImmoScout24 public PKCE/OIDC flow without routing the user's password or second-factor code through Traumwohnung infrastructure.

Flow:

1. Telegram starts an ImmoScout24 authorization request using the public PKCE client.
2. ImmoScout24 hosts the complete sign-in and MFA experience.
3. ImmoScout24 redirects to its registered custom callback `immobilienscout24.de:/loginCallback`.
4. This helper receives only that OAuth callback and forwards the one-time authorization code/state to `immoscout-native-handoff`.
5. Supabase exchanges the code with the server-held PKCE verifier and stores only encrypted OAuth tokens.

The app contains no ImmoScout24 password form, no OTP/TOTP/SMS-code form and no provider credentials or backend secrets.

## Build

The project is described with XcodeGen. On macOS with Xcode and XcodeGen installed:

```bash
cd clients/immoscout-callback-helper-ios
xcodegen generate
open TraumwohnungImmoScoutHandoff.xcodeproj
```

Select the NexaLabs Apple development team and a unique bundle identifier if required, then run on the target iPhone or distribute through TestFlight.

## Important iOS limitation

Custom URL schemes are not globally exclusive on iOS. The official ImmoScout24 app may register the same callback scheme. If more than one installed app claims `immobilienscout24.de`, iOS does not provide a reliable app-selection contract. This helper therefore needs a controlled installation/test before it can be used as a production onboarding path. Do not switch the Telegram production login to this transport until callback ownership has been verified on the target iPhone.
