// Firebase setup for Rough Work. Owned by T1.
//
// Env values come from import.meta.env.VITE_* (see .env.example). When they are
// missing, the module still loads (so the app and tests run), but
// isFirebaseConfigured() is false and every network call fails with a clear error.
import { initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from 'firebase/app-check';
import { getAuth, onAuthStateChanged, signInAnonymously, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  Schema,
  type AI,
  type GenerativeModel,
  type LanguageModelCreateOptions,
  type ModelParams,
} from 'firebase/ai';
import type { AppConfig } from './types';

const env = import.meta.env;

const firebaseConfig: FirebaseOptions = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

const REQUIRED_KEYS = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'] as const;

/** Names of required env vars that are empty. */
export function missingFirebaseEnv(): string[] {
  return REQUIRED_KEYS.filter((k) => !env[k]);
}

/** True when the required Firebase env vars are set. */
export function isFirebaseConfigured(): boolean {
  return missingFirebaseEnv().length === 0;
}

/** Message for the UI when Firebase is not configured. */
export const NOT_CONFIGURED_MESSAGE =
  'Firebase is not configured. Copy .env.example to .env.local, fill in the VITE_FIREBASE_* values, and restart the dev server.';

/** Throws a clear error when Firebase env vars are missing. */
export function assertFirebaseConfigured(): void {
  if (!isFirebaseConfigured()) {
    throw new Error(`${NOT_CONFIGURED_MESSAGE} Missing: ${missingFirebaseEnv().join(', ')}.`);
  }
}

// With no env, use placeholders so the SDK objects can be created without throwing.
// Nothing is sent anywhere: every call path checks isFirebaseConfigured() first.
export const app: FirebaseApp = initializeApp(
  isFirebaseConfigured()
    ? firebaseConfig
    : { apiKey: 'not-configured', projectId: 'not-configured', appId: 'not-configured' },
);

declare global {
  // Read by the App Check SDK in dev. `true` prints a new debug token to the console.
  var FIREBASE_APPCHECK_DEBUG_TOKEN: boolean | string | undefined;
}

function setUpAppCheck(): AppCheck | null {
  if (!isFirebaseConfigured() || typeof window === 'undefined') return null;
  const siteKey = env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
  if (env.DEV) {
    const debug = env.VITE_APPCHECK_DEBUG_TOKEN;
    // "true" (or empty) asks the SDK to print a debug token; any other value is a registered token.
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = !debug || debug === 'true' ? true : debug;
  }
  if (!siteKey) {
    console.warn('[firebase] VITE_RECAPTCHA_ENTERPRISE_SITE_KEY is empty. App Check is off.');
    return null;
  }
  return initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export const appCheck: AppCheck | null = setUpAppCheck();
export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);
export const ai: AI = getAI(app, { backend: new GoogleAIBackend() });

let signInPromise: Promise<string> | null = null;

/** Signs in anonymously once and returns the uid. */
export function ensureSignedIn(): Promise<string> {
  if (!isFirebaseConfigured()) {
    return Promise.reject(new Error(NOT_CONFIGURED_MESSAGE));
  }
  if (auth.currentUser) return Promise.resolve(auth.currentUser.uid);
  if (!signInPromise) {
    signInPromise = new Promise<string>((resolve, reject) => {
      // Wait for persisted auth state first, so a returning user keeps their uid.
      const unsubscribe = onAuthStateChanged(
        auth,
        (user) => {
          unsubscribe();
          if (user) {
            resolve(user.uid);
            return;
          }
          signInAnonymously(auth).then((cred) => resolve(cred.user.uid), reject);
        },
        reject,
      );
    }).catch((err: unknown) => {
      signInPromise = null; // allow a retry
      throw err;
    });
  }
  return signInPromise;
}

/** JSON shape the read model must return. Used for the cloud responseSchema. */
export const readResponseSchema = Schema.object({
  properties: {
    latex: Schema.string({ description: 'The line in LaTeX.' }),
    plain: Schema.string({ description: 'The line as plain ASCII maths using * ^ / = and parentheses.' }),
    confidence: Schema.number({ description: 'How sure you are of the transcription, 0 to 1.' }),
  },
});

/** Same shape as a JSON Schema, for the on-device Prompt API responseConstraint. */
export const readResponseJsonSchema = {
  type: 'object',
  properties: {
    latex: { type: 'string' },
    plain: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['latex', 'plain', 'confidence'],
  additionalProperties: false,
} as const;

/** On-device session options. Shared by the read model and availability checks. */
export const onDeviceCreateOptions: LanguageModelCreateOptions = {
  expectedInputs: [{ type: 'text', languages: ['en'] }, { type: 'image' }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

const readModels = new Map<string, GenerativeModel>();
const cloudModels = new Map<string, GenerativeModel>();

/**
 * Hybrid read model: Gemini Nano on device when available, else cfg.cloudModel.
 * Cached per cloud model name so the on-device adapter (and its download state) is reused.
 */
export function getReadModel(cfg: AppConfig): GenerativeModel {
  let model = readModels.get(cfg.cloudModel);
  if (!model) {
    model = getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_ON_DEVICE,
      onDeviceParams: {
        createOptions: { ...onDeviceCreateOptions },
        promptOptions: { responseConstraint: readResponseJsonSchema },
      },
      inCloudParams: {
        model: cfg.cloudModel,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: readResponseSchema,
          temperature: 0,
        },
      },
    });
    readModels.set(cfg.cloudModel, model);
  }
  return model;
}

/**
 * Cloud-only model (cfg.cloudModel). Callers pass their own generationConfig
 * per request (GenerateContentRequest.generationConfig overrides the model's).
 * `params` lets a caller set a default systemInstruction or generationConfig.
 */
export function getCloudModel(cfg: AppConfig, params: Omit<ModelParams, 'model'> = {}): GenerativeModel {
  const key = `${cfg.cloudModel}|${JSON.stringify(params)}`;
  let model = cloudModels.get(key);
  if (!model) {
    model = getGenerativeModel(ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: { model: cfg.cloudModel, ...params },
    });
    cloudModels.set(key, model);
  }
  return model;
}
