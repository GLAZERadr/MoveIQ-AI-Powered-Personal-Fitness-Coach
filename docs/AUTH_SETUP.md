# Google and GitHub sign-in

Sign-in is optional in MoveIQ. All training data stays on the phone either way. Signing in makes cloud backups and share links belong to your account instead of one phone, so you can restore backups on a new device.

**How it works:** the app opens Google/GitHub in the system browser. The provider redirects to our API (`https://moveiq-api.vercel.app/api/auth/callback/<provider>`), which creates the session in Neon Postgres (Better Auth tables `user`, `session`, `account`, `verification`) and sends you back to the app via the `moveiq://` deep link. The session is stored in the phone's encrypted keystore.

Everything is already built and deployed. The only missing piece is **your OAuth credentials**: a Client ID and Client Secret for each provider.

## 1. Google (about 10 minutes)

1. Go to <https://console.cloud.google.com> and create a project named **MoveIQ** (or pick one).
2. Open **Google Auth Platform** (APIs & Services → OAuth consent screen) and click **Get started**:
   - App name **MoveIQ**, support email: yours.
   - Audience: **External**.
   - Contact email: yours. Accept the policy → **Create**.
3. Under **Audience → Test users**, add the Google account(s) you'll sign in with. While the app is in *Testing*, only these accounts can sign in. Publishing later requires Google's review.
4. Go to **Clients → Create client**:
   - Application type: **Web application**. Not "Android": the sign-in happens on our server, not inside the app.
   - Name: `MoveIQ API`.
   - **Authorized redirect URIs**, add both:
     - `https://moveiq-api.vercel.app/api/auth/callback/google`
     - `http://localhost:8787/api/auth/callback/google` (local testing)
   - **Create**, then copy the **Client ID** and **Client secret**.

## 2. GitHub (about 3 minutes)

1. Go to <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**.
2. Fill in:
   - Application name: **MoveIQ**
   - Homepage URL: `https://moveiq-api.vercel.app`
   - Authorization callback URL: `https://moveiq-api.vercel.app/api/auth/callback/github`
3. **Register application** → copy the **Client ID** → **Generate a new client secret** and copy it (it's shown only once).

> A GitHub OAuth app allows only one callback URL. For local testing, create a second app with callback `http://localhost:8787/api/auth/callback/github`.

## 3. Put the keys in the project (don't paste them into chat)

Open `.env.auth.local` in the project root (it's gitignored) and fill in:

```
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

Then send them to Vercel (stored as sensitive production variables, never printed) and redeploy:

```bash
npm run auth:push
```

It ends with `Enabled providers: google, github`.

## 4. Try it on your Android phone

Deep links and the secure session store need the development build (see [ANDROID_SETUP.md](ANDROID_SETUP.md)); Expo Go won't work.

1. Profile → **Account** → **Continue with Google** (or GitHub).
2. Choose your account in the browser and approve.
3. You land back in MoveIQ, and the Account card shows your name and email.
4. **Back up now**, then sign in on another phone → **Show my backups** lists it.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| "Sign-in isn't set up on the server yet" | No keys pushed yet. Run `npm run auth:push`. |
| Google: `redirect_uri_mismatch` | The redirect URI in Google Cloud must match `https://moveiq-api.vercel.app/api/auth/callback/google` exactly. |
| Google: "Access blocked: app not verified" or "not a test user" | Add your account under Audience → Test users. |
| GitHub: "redirect_uri is not associated" | The callback URL in the GitHub app must be exactly the one above. |
| Browser doesn't return to the app | You're in Expo Go or an old build. Install the MoveIQ dev build (it registers the `moveiq://` scheme). |

## Security notes

- Client secrets live only in `.env.auth.local` (local) and Vercel (encrypted). They're never bundled into the app.
- Production and local use different `BETTER_AUTH_SECRET` values; rotating it signs everyone out.
- No passwords are stored (email/password sign-in is disabled).
- Still to do before a public launch: rate limiting, and Google consent-screen verification if you publish beyond test users.
