'use client';

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  browserPopupRedirectResolver,
  UserCredential,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

interface InternalPopupResolver {
  _initialize?: (authInstance: unknown) => Promise<unknown>;
  _isIframeWebStorageSupported?: (
    authInstance: unknown,
    cb: (supported: boolean) => void
  ) => void;
  _originValidation?: (authInstance: unknown) => Promise<void>;
}

/**
 * Workaround for @firebase/auth 13.1.0 PopupOperation bug where:
 * 1) _isIframeWebStorageSupported falls through to _fail(auth, 'internal-error') or rejects
 *    pendingPromise while pollUserCancellation() is active, causing
 *    "INTERNAL ASSERTION FAILED: Pending promise was never set" when the poll timer fires.
 * 2) Concurrent signInWithPopup calls cancel op1 while op1 is awaiting _initialize(),
 *    causing op1.onExecution() to start polling with pendingPromise === null.
 */
function hardenPopupResolver() {
  if (typeof window === 'undefined') return;
  try {
    const resolverProto = (
      browserPopupRedirectResolver as unknown as { prototype?: InternalPopupResolver }
    )?.prototype;
    if (resolverProto) {
      resolverProto._isIframeWebStorageSupported = (
        _authInstance: unknown,
        cb: (supported: boolean) => void
      ) => {
        cb(true);
      };
      resolverProto._originValidation = () => Promise.resolve();
    }

    const activeResolver = (
      auth as unknown as { _popupRedirectResolver?: InternalPopupResolver }
    )?._popupRedirectResolver;
    if (activeResolver) {
      activeResolver._isIframeWebStorageSupported = (
        _authInstance: unknown,
        cb: (supported: boolean) => void
      ) => {
        cb(true);
      };
      activeResolver._originValidation = () => Promise.resolve();
    }
  } catch {
    // Ignore if internal structure differs
  }
}

hardenPopupResolver();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

let connectionTested = false;
export async function testFirestoreConnection(): Promise<boolean> {
  hardenPopupResolver();
  if (typeof window !== 'undefined') {
    const activeResolver = (
      auth as unknown as { _popupRedirectResolver?: InternalPopupResolver }
    )?._popupRedirectResolver;
    if (activeResolver && typeof activeResolver._initialize === 'function') {
      void activeResolver._initialize(auth).catch(() => {});
    }
  }
  if (connectionTested) return true;
  connectionTested = true;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      return false;
    }
    // Permission denied on /test/connection means the client IS online and reached Firestore!
    return true;
  }
}

let activeSignInPromise: Promise<UserCredential | null> | null = null;

export async function signInWithGoogle(): Promise<UserCredential | null> {
  hardenPopupResolver();
  if (activeSignInPromise) {
    return activeSignInPromise;
  }

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  activeSignInPromise = signInWithPopup(auth, provider)
    .catch((err: unknown) => {
      const code = (err as { code?: string })?.code || '';
      if (
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/cancelled-popup-request' ||
        code === 'auth/popup-blocked'
      ) {
        return null;
      }
      throw err;
    })
    .finally(() => {
      activeSignInPromise = null;
    });

  return activeSignInPromise;
}

export async function signOutUser() {
  return signOut(auth);
}

/**
 * Syncs an operational ticket and its workflow run to the user's authenticated Firestore workspace
 * while adhering strictly to the volumetric and schema constraints in firebase-blueprint.json.
 */
export async function syncStateToFirestore(payload: {
  ticket?: {
    id: string;
    orderId: string;
    subject: string;
    customerName: string;
    category: string;
    status: string;
    priority: string;
    scenarioId: string;
  };
  workflowRun?: {
    id: string;
    ticketId: string;
    orderId: string;
    mode: 'demo_deterministic' | 'live_ai';
    status: string;
    currentNode: string;
    retryCount: number;
    totalLatencyMs: number;
    estimatedCostUsd: number;
    summaryText: string;
  };
}) {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) return false;

  const uid = currentUser.uid;

  if (payload.ticket) {
    const t = payload.ticket;
    const cleanId = t.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
    const ticketPath = `tickets/${cleanId}`;
    try {
      await setDoc(doc(db, 'tickets', cleanId), {
        id: cleanId,
        orderId: String(t.orderId).slice(0, 128),
        subject: String(t.subject).slice(0, 300),
        customerName: String(t.customerName).slice(0, 120),
        category: t.category,
        status: t.status,
        priority: t.priority,
        scenarioId: String(t.scenarioId || 'custom').slice(0, 64),
        ownerId: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, ticketPath);
    }
  }

  if (payload.workflowRun) {
    const r = payload.workflowRun;
    const cleanRunId = r.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
    const cleanTicketId = r.ticketId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
    const runPath = `workflowRuns/${cleanRunId}`;
    try {
      await setDoc(doc(db, 'workflowRuns', cleanRunId), {
        id: cleanRunId,
        ticketId: cleanTicketId,
        orderId: String(r.orderId).slice(0, 128),
        mode: r.mode,
        status: r.status,
        currentNode: String(r.currentNode).slice(0, 64),
        retryCount: Math.min(Math.max(0, Number(r.retryCount) || 0), 10),
        totalLatencyMs: Math.min(Math.max(0, Number(r.totalLatencyMs) || 0), 600000),
        estimatedCostUsd: Math.min(Math.max(0, Number(r.estimatedCostUsd) || 0), 100),
        summaryText: String(r.summaryText || 'Workflow traced').slice(0, 2000),
        ownerId: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, runPath);
    }
  }

  return true;
}
