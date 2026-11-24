# Firebase console setup

Do these steps once, in order. Tick each box when it is done. Console labels change from time to time; if a label is different, look for the nearest match.

You need: a Google account, Chrome, and about 30 minutes.

Keep `.env.local` open in an editor. Steps 2 and 7 give you values to paste into it.

## 1. Create the project

- [ ] Open <https://console.firebase.google.com>.
- [ ] Click **Create a project** (or **Add project**).
- [ ] Enter the name `rough-work`. Write down the **project ID** under the name (for example `rough-work-1a2b3`).
- [ ] Turn Google Analytics **off**. The app does not use it.
- [ ] Click **Create project**. Wait, then click **Continue**.
- [ ] In the repo, open `.firebaserc`. Replace `rough-work-REPLACE_ME` with the project ID.

## 2. Add the web app

- [ ] On **Project overview**, click the web icon **`</>`** (**Add app** > **Web**).
- [ ] Nickname: `rough-work-web`.
- [ ] Do not tick **Also set up Firebase Hosting**. Step 9 does it.
- [ ] Click **Register app**.
- [ ] Copy the values from the `firebaseConfig` object into `.env.local`:

  | `firebaseConfig` field | `.env.local` variable |
  |---|---|
  | `apiKey` | `VITE_FIREBASE_API_KEY` |
  | `authDomain` | `VITE_FIREBASE_AUTH_DOMAIN` |
  | `projectId` | `VITE_FIREBASE_PROJECT_ID` |
  | `storageBucket` | `VITE_FIREBASE_STORAGE_BUCKET` |
  | `messagingSenderId` | `VITE_FIREBASE_MESSAGING_SENDER_ID` |
  | `appId` | `VITE_FIREBASE_APP_ID` |

- [ ] Click **Continue to console**.

## 3. Enable Firebase AI Logic (Gemini Developer API)

- [ ] In the left menu, open **Build** > **AI Logic** (it can also be under **AI**).
- [ ] Click **Get started**.
- [ ] Choose **Gemini Developer API**. Do not choose Vertex AI.
- [ ] Click **Enable API** and wait until it is done. Firebase creates the Gemini API key for you. Do not copy it into the app; Firebase AI Logic uses it on the server side.
- [ ] Click **Continue**. Skip the code sample.

## 4. Enable Anonymous Auth

- [ ] Open **Build** > **Authentication**.
- [ ] Click **Get started**.
- [ ] Open the **Sign-in method** tab.
- [ ] Click **Anonymous**.
- [ ] Turn on **Enable**. Click **Save**.

## 5. Create Firestore (region asia-south1)

- [ ] Open **Build** > **Firestore Database**.
- [ ] Click **Create database**.
- [ ] Edition: **Standard**. Database ID: keep `(default)`.
- [ ] Location: **asia-south1 (Mumbai)**. You cannot change this later.
- [ ] Rules: choose **Start in production mode**. The real rules come from `firestore.rules` on deploy.
- [ ] Click **Create**.

## 6. Publish Remote Config

Choose one option.

**Option A: deploy the template from the repo (recommended).**

- [ ] Open **Run** > **Remote Config** and click **Create configuration** once, so the service is on. You can close the dialog without adding a parameter.
- [ ] In the repo, run:

  ```sh
  npx firebase-tools@15.37.0 login
  npx firebase-tools@15.37.0 deploy --only remoteconfig
  ```

- [ ] Reload the Remote Config page. Check that it shows 7 parameters.

**Option B: add the parameters by hand.**

- [ ] Open **Run** > **Remote Config** > **Create configuration**.
- [ ] Add each parameter below with **Add parameter**. Use the data type shown. Copy the default from `remoteconfig.template.json`.

  | Parameter | Data type | Default |
  |---|---|---|
  | `frame_interval_ms` | Number | `8000` |
  | `cloud_frame_interval_ms` | Number | `20000` |
  | `confidence_threshold` | Number | `0.6` |
  | `daily_cloud_cap` | Number | `50` |
  | `read_prompt` | String | from the template |
  | `explain_prompt` | String | from the template |
  | `cloud_model` | String | `gemini-3.5-flash-lite` |

- [ ] Click **Publish changes**, then **Publish** again in the dialog.

If you skip this step, the app still works. It uses the defaults in `src/config.ts`.

## 7. Turn on App Check with reCAPTCHA Enterprise

### 7a. Create the reCAPTCHA Enterprise key

- [ ] Open <https://console.cloud.google.com/security/recaptcha>. At the top, select the same project as the Firebase project.
- [ ] If asked, click **Enable** for the reCAPTCHA Enterprise API. If Google Cloud asks for a billing account, link one (the $300 credit account is fine).
- [ ] Click **Create key**.
- [ ] Display name: `rough-work-web`. Platform: **Website**.
- [ ] Domains: add `localhost`, `<project-id>.web.app` and `<project-id>.firebaseapp.com`.
- [ ] Do not use a checkbox challenge. The key must be score-based.
- [ ] Click **Create key**.
- [ ] Copy the key ID (the site key). Put it in `.env.local` as `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`.

### 7b. Register the web app in App Check

- [ ] In the Firebase console, open **Build** > **App Check**. Click **Get started** if shown.
- [ ] Open the **Apps** tab. Click `rough-work-web`.
- [ ] Choose **reCAPTCHA Enterprise**.
- [ ] Paste the site key from step 7a. Keep the default token time to live.
- [ ] Click **Save**.

Do not turn on enforcement yet. Step 10 does it.

## 8. Register the App Check debug token (local development)

The debug token lets `localhost` pass App Check. It is a secret. Do this step yourself. Do not paste the token in chat, in an issue, or in the repo.

- [ ] In `.env.local`, set `VITE_APPCHECK_DEBUG_TOKEN=true`.
- [ ] Run `npm run dev` and open the app in Chrome.
- [ ] Open DevTools (F12) > **Console**. Copy the token from the line `App Check debug token: ...`.
- [ ] In the Firebase console, open **Build** > **App Check** > **Apps**.
- [ ] On `rough-work-web`, click the overflow menu (**⋮**) > **Manage debug tokens**.
- [ ] Click **Add debug token**. Name: `dev-laptop`. Value: paste the token.
- [ ] Click **Save**, then **Done**.
- [ ] In `.env.local`, replace `true` with the token. Restart `npm run dev`.

## 9. Set up Hosting

- [ ] Open **Build** > **Hosting**. Click **Get started**.
- [ ] Check that `firestore.rules` and `firestore.indexes.json` exist in the repo. If not, deploy with `--only hosting,remoteconfig` for now.
- [ ] Click **Next** through the CLI install and init steps. The repo already has `firebase.json` and `.firebaserc`, and the CLI runs through `npx`.
- [ ] Click **Continue to console**.
- [ ] In the repo, run:

  ```sh
  npm run build
  npx firebase-tools@15.37.0 deploy
  ```

- [ ] Open `https://<project-id>.web.app` in a clean Chrome profile. Check that the app loads.
- [ ] Check that `<project-id>.web.app` is in the reCAPTCHA key's domains (step 7a).

## 10. Enforce App Check

Do this only after the hosted app and `localhost` both work.

- [ ] Open **Build** > **App Check** > **APIs** tab.
- [ ] Find the entry for the Gemini API that AI Logic uses (the label can be **Firebase AI Logic** or **Gemini Developer API**). Open its metrics. Check that most requests are **Verified**.
- [ ] If there is no such entry, AI Logic is not enforced from this page. Check the AI Logic page (**Build** > **AI Logic** > **Settings**) for an App Check option.
- [ ] Click **Enforce**, then **Confirm**.
- [ ] Do the same for **Cloud Firestore**.
- [ ] Reload the app on `localhost` and on the hosted URL. Check that reads and explanations still work.

## Done

- [ ] `.env.local` has all 8 values. `git status` does not show `.env.local`.
- [ ] `.firebaserc` has the real project ID.
- [ ] `npm run dev` works on `localhost` with App Check.
- [ ] The hosted URL works in a clean Chrome profile.
