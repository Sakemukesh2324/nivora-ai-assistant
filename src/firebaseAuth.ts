import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  verifyPasswordResetCode,
  confirmPasswordReset,
  onAuthStateChanged,
  updateProfile,
  setPersistence,
  browserLocalPersistence,
  User,
  Auth
} from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  Firestore,
  collection,
  setDoc,
  getDocs,
  deleteDoc
} from "firebase/firestore";
import firebaseConfigFallback from "../firebase-applet-config.json";

export interface NivoraUser {
  uid: string; // Firebase UID
  user_id: string; // Firebase UID
  name: string;
  email: string;
  profile_picture: string;
  email_verified: boolean;
}

export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
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

let app: any = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let currentNivoraUser: NivoraUser | null = null;
let isInitialAuthResolved = false;

// Format user-friendly error messages according to requirements
export function formatAuthError(err: any, context?: "login" | "signup" | "reset"): string {
  if (!err) return "An unexpected error occurred. Please try again.";
  const code = err.code || "";
  const msg = String(err.message || err);

  switch (code) {
    case "auth/popup-closed-by-user":
      return "Google sign-in was cancelled.";
    case "auth/cancelled-popup-request":
      return "Sign-in popup request was cancelled.";
    case "auth/popup-blocked":
      return "The sign-in popup was blocked by your browser. Please allow popups for this site.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/invalid-login-credentials":
      return "Incorrect email or password.";
    case "auth/user-not-found":
      if (context === "reset") {
        return "No account found with this email address. Please check your email or create an account.";
      }
      return "Incorrect email or password.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/email-already-in-use":
      return "An account already exists with this email. Please log in instead.";
    case "auth/weak-password":
      return "Password is too weak. Please use at least 6 characters.";
    case "auth/missing-password":
      return "Please enter your password.";
    case "auth/missing-email":
      return "Please enter your email address.";
    case "auth/too-many-requests":
      return "Too many requests. Please wait a few minutes before trying again.";
    case "auth/network-request-failed":
      return "Network connection error. Please check your internet connection.";
    case "auth/unauthorized-domain": {
      const currentHost = typeof window !== "undefined" ? window.location.hostname : "nivora.org";
      return `Domain authorization required: The domain '${currentHost}' is not yet added to 'Authorized domains' in Firebase Authentication. In Firebase Console, go to Authentication > Settings > Authorized domains and add '${currentHost}'.`;
    }
    case "auth/account-exists-with-different-credential":
      return "An account already exists with this email using a different sign-in method. Please sign in using your existing method.";
    case "auth/operation-not-allowed":
      return "Email/Password sign-in is disabled in your Firebase project (nivora-35e5b). Please enable 'Email/Password' under Authentication > Sign-in method in the Firebase Console.";
    case "auth/unauthorized-continue-uri":
      return "The reset password redirect domain is not allowlisted in Firebase Authentication settings.";
    case "auth/expired-action-code":
      return "The password reset link or code has expired. Please request a new one.";
    case "auth/invalid-action-code":
      return "The password reset code or link is invalid or has already been used. Please request a new one.";
    case "auth/user-disabled":
      return "This account has been disabled. Please contact support.";
    case "auth/requires-recent-login":
      return "This operation requires recent authentication. Please log in again.";
    default:
      if (msg.includes("popup-closed-by-user")) return "Google sign-in was cancelled.";
      if (msg.includes("unauthorized-domain") || msg.includes("auth/unauthorized-domain")) {
        const currentHost = typeof window !== "undefined" ? window.location.hostname : "nivora.org";
        return `Domain authorization required: The domain '${currentHost}' must be added to 'Authorized domains' in Firebase Console (Authentication > Settings > Authorized domains).`;
      }
      if (msg.includes("PASSWORD_LOGIN_DISABLED") || msg.includes("OPERATION_NOT_ALLOWED")) {
        return "Email/Password sign-in is disabled in your Firebase project (nivora-35e5b). Please enable 'Email/Password' under Authentication > Sign-in method in Firebase Console.";
      }
      return msg.replace(/^Firebase:\s*/i, "").replace(/\s*\(auth\/[^)]+\)\.?$/i, "");
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const currentAuth = auth?.currentUser;
  const rawMsg = error instanceof Error ? error.message : String(error);
  const errorCode = (error as any)?.code || "";
  const isUnavailable = errorCode === "unavailable" || rawMsg.toLowerCase().includes("unavailable");

  const errInfo: FirestoreErrorInfo = {
    error: rawMsg,
    authInfo: {
      userId: currentAuth?.uid,
      email: currentAuth?.email,
      emailVerified: currentAuth?.emailVerified,
      isAnonymous: currentAuth?.isAnonymous,
      tenantId: currentAuth?.tenantId,
      providerInfo: currentAuth?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };

  if (isUnavailable) {
    console.warn("[Firestore Notice] Database temporarily unavailable or offline. Will retry automatically:", path);
    return;
  }

  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function toNivoraUser(firebaseUser: User): NivoraUser {
  return {
    uid: firebaseUser.uid,
    user_id: firebaseUser.uid,
    name: firebaseUser.displayName || (firebaseUser.email ? firebaseUser.email.split("@")[0] : "NIVORA User"),
    email: firebaseUser.email || "",
    profile_picture: firebaseUser.photoURL || "",
    email_verified: Boolean(firebaseUser.emailVerified)
  };
}

// Initialize Firebase SDK with server-provided config or fallback
async function getFirebaseConfig() {
  try {
    const res = await fetch("/api/firebase-config");
    if (res.ok) {
      const cfg = await res.json();
      if (cfg && cfg.apiKey && cfg.projectId) {
        return cfg;
      }
    }
  } catch (err) {
    console.warn("Could not fetch remote Firebase config, using local config:", err);
  }
  return firebaseConfigFallback;
}

// Global resolve for ready promise
let resolveReady: () => void;
const readyPromise = new Promise<void>((resolve) => {
  resolveReady = resolve;
});

export async function initFirebase(): Promise<{ app: any; auth: Auth; db: Firestore }> {
  if (app && auth && db) {
    return { app, auth, db };
  }

  const config = await getFirebaseConfig();
  if (!getApps().length) {
    app = initializeApp(config);
  } else {
    app = getApp();
  }

  auth = getAuth(app);
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (err) {
    console.warn("Could not set local persistence:", err);
  }

  db = getFirestore(app, config.firestoreDatabaseId);

  // Test connection to Firestore as per skill guideline
  try {
    if (db) {
      getDocFromServer(doc(db, "test", "connection")).catch((err) => {
        if (err instanceof Error && err.message.includes("the client is offline")) {
          console.error("Please check your Firebase configuration.");
        }
      });
    }
  } catch (_) {}

  // Set up auth state observer
  onAuthStateChanged(auth, (firebaseUser) => {
    if (firebaseUser) {
      currentNivoraUser = toNivoraUser(firebaseUser);
    } else {
      currentNivoraUser = null;
    }

    if (!isInitialAuthResolved) {
      isInitialAuthResolved = true;
      resolveReady();
    }

    // Dispatch global event for vanilla JS app.js
    window.dispatchEvent(
      new CustomEvent("nivora:auth-state-changed", {
        detail: { user: currentNivoraUser, firebaseUser }
      })
    );
  });

  return { app, auth, db };
}

// ----------------------------------------------------------------------
// AUTH OPERATIONS
// ----------------------------------------------------------------------

export async function loginWithEmail(email: string, pass: string): Promise<NivoraUser> {
  if (!auth) await initFirebase();
  if (!auth) throw new Error("Firebase Auth not initialized");

  const credential = await signInWithEmailAndPassword(auth, email.trim(), pass);
  currentNivoraUser = toNivoraUser(credential.user);
  try {
    const profile = await getUserProfileFromFirestore(currentNivoraUser.uid);
    if (profile && profile.name) {
      currentNivoraUser.name = profile.name;
    }
    await saveUserProfileToFirestore(currentNivoraUser);
  } catch (_) {}
  return currentNivoraUser;
}

export async function signupWithEmail(name: string, email: string, pass: string): Promise<NivoraUser> {
  if (!auth) await initFirebase();
  if (!auth) throw new Error("Firebase Auth not initialized");

  const credential = await createUserWithEmailAndPassword(auth, email.trim(), pass);
  if (name.trim()) {
    try {
      await updateProfile(credential.user, { displayName: name.trim() });
    } catch (e) {
      console.warn("Could not set displayName:", e);
    }
  }
  currentNivoraUser = toNivoraUser(credential.user);
  if (name.trim()) {
    currentNivoraUser.name = name.trim();
  }
  try {
    await saveUserProfileToFirestore(currentNivoraUser);
  } catch (err) {
    console.warn("Could not save initial profile to Firestore:", err);
  }
  return currentNivoraUser;
}

export async function loginWithGoogle(): Promise<NivoraUser> {
  if (!auth) await initFirebase();
  if (!auth) throw new Error("Firebase Auth not initialized");

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  const credential = await signInWithPopup(auth, provider);
  currentNivoraUser = toNivoraUser(credential.user);
  try {
    await saveUserProfileToFirestore(currentNivoraUser);
  } catch (err) {
    console.warn("Could not save Google profile to Firestore:", err);
  }
  return currentNivoraUser;
}

export async function checkEmailPasswordProviderStatus(): Promise<{ enabled: boolean; reason?: string }> {
  try {
    const config = await getFirebaseConfig();
    const probeResp = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(config.apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "probe_check@example.com",
          password: "__check_provider_status__",
          returnSecureToken: false
        })
      }
    );
    const data = await probeResp.json();
    if (data?.error?.message === "PASSWORD_LOGIN_DISABLED" || data?.error?.message === "OPERATION_NOT_ALLOWED") {
      return {
        enabled: false,
        reason: data.error.message
      };
    }
    return { enabled: true };
  } catch (probeErr) {
    console.warn("Could not probe Firebase Email/Password provider status:", probeErr);
    return { enabled: true };
  }
}

export async function resetPassword(email: string): Promise<void> {
  if (!auth) await initFirebase();
  if (!auth) throw new Error("Firebase Auth not initialized");

  const cleanEmail = (email || "").trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes("@")) {
    const err: any = new Error("Please enter a valid email address.");
    err.code = "auth/invalid-email";
    throw err;
  }

  try {
    // Official Firebase password reset flow: dispatches the verified reset link email
    await sendPasswordResetEmail(auth, cleanEmail);
    console.log(`[Firebase Auth] Password reset email successfully requested for: ${cleanEmail}`);
  } catch (err: any) {
    console.warn("[Firebase Auth] Password reset request failed:", err?.message || err);
    throw err;
  }
}

export async function verifyResetCode(code: string): Promise<string> {
  if (!auth) await initFirebase();
  if (!auth) throw new Error("Firebase Auth not initialized");
  return await verifyPasswordResetCode(auth, code);
}

export async function confirmNewPassword(code: string, newPass: string): Promise<void> {
  if (!auth) await initFirebase();
  if (!auth) throw new Error("Firebase Auth not initialized");
  await confirmPasswordReset(auth, code, newPass);
}

export function sanitizeForFirestore(obj: any): any {
  if (obj === undefined) return null;
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj
      .filter((item) => item !== undefined)
      .map((item) => sanitizeForFirestore(item));
  }
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = sanitizeForFirestore(value);
    }
  }
  return result;
}

export async function signOut(): Promise<void> {
  console.log("NIVORA sign out clicked");
  if (!auth) await initFirebase();
  if (!auth) {
    throw new Error("Firebase Auth not initialized");
  }

  try {
    await firebaseSignOut(auth);
    currentNivoraUser = null;
    console.log("Firebase sign out successful");
  } catch (err: any) {
    console.error("Firebase sign out error:", err?.message || err);
    throw new Error(formatAuthError(err) || "Failed to sign out. Please try again.");
  }

  try {
    await fetch("/auth/logout", { method: "POST" });
  } catch (_) {}

  window.dispatchEvent(
    new CustomEvent("nivora:auth-state-changed", {
      detail: { user: null, firebaseUser: null }
    })
  );
}

export function getCurrentUser(): NivoraUser | null {
  return currentNivoraUser;
}

export function getFirebaseUser(): User | null {
  return auth?.currentUser || null;
}

export function onAuthState(callback: (user: NivoraUser | null) => void): () => void {
  const handler = (e: Event) => {
    const customEvent = e as CustomEvent<{ user: NivoraUser | null }>;
    callback(customEvent.detail.user);
  };
  window.addEventListener("nivora:auth-state-changed", handler);
  // Immediately invoke if already resolved
  if (isInitialAuthResolved) {
    callback(currentNivoraUser);
  }
  return () => {
    window.removeEventListener("nivora:auth-state-changed", handler);
  };
}

export async function saveUserProfileToFirestore(user: NivoraUser): Promise<void> {
  const currentAuth = auth?.currentUser;
  if (!currentAuth || !db || !user.uid) return;
  try {
    const userDocRef = doc(db, "users", user.uid);
    const dataToSave = sanitizeForFirestore({
      uid: user.uid,
      name: user.name || (user.email ? user.email.split("@")[0] : "NIVORA User"),
      email: user.email,
      photoURL: user.profile_picture || "",
      createdAt: String(Date.now()),
      updatedAt: String(Date.now())
    });
    await setDoc(userDocRef, dataToSave, { merge: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
  }
}

export async function getUserProfileFromFirestore(uid: string): Promise<any | null> {
  if (!db || !uid) return null;
  try {
    const userDocRef = doc(db, "users", uid);
    const snapshot = await getDoc(userDocRef);
    return snapshot.exists() ? snapshot.data() : null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `users/${uid}`);
    return null;
  }
}

export async function saveChatToFirestore(chat: any): Promise<void> {
  const user = auth?.currentUser;
  if (!user || !db || !chat || !chat.id) return;
  try {
    const rawMessages = Array.isArray(chat.messages) ? chat.messages.slice(-50) : [];
    const cleanMessages = rawMessages.map((m: any) => {
      const msgObj: any = {
        id: String(m.id || Date.now()),
        role: String(m.role || "user"),
        content: String(m.content || ""),
        timestamp: Number(m.timestamp || Date.now()),
        provider: m.provider ? String(m.provider) : "NIVORA AI"
      };
      if (m.sources) msgObj.sources = sanitizeForFirestore(m.sources);
      if (m.imageUrl) msgObj.imageUrl = String(m.imageUrl);
      return msgObj;
    });

    const chatDocRef = doc(db, "users", user.uid, "chats", String(chat.id));
    const dataToSave = sanitizeForFirestore({
      id: String(chat.id),
      userId: user.uid,
      title: chat.title || "New Chat",
      pinned: Boolean(chat.pinned),
      archived: Boolean(chat.archived),
      updatedAt: String(chat.updatedAt || Date.now()),
      createdAt: String(chat.createdAt || Date.now()),
      messages: cleanMessages
    });

    await setDoc(chatDocRef, dataToSave, { merge: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/chats/${chat.id}`);
  }
}

export async function deleteChatFromFirestore(chatId: string): Promise<void> {
  const user = auth?.currentUser;
  if (!user || !db || !chatId) return;
  try {
    const chatDocRef = doc(db, "users", user.uid, "chats", String(chatId));
    await deleteDoc(chatDocRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}/chats/${chatId}`);
  }
}

export async function getChatsFromFirestore(): Promise<any[]> {
  const user = auth?.currentUser;
  if (!user || !db) return [];
  try {
    const chatsCol = collection(db, "users", user.uid, "chats");
    const snapshot = await getDocs(chatsCol);
    const result: any[] = [];
    snapshot.forEach((d) => {
      const data: any = d.data();
      if (data && Array.isArray(data.messages)) {
        data.messages = data.messages.map((m: any) => {
          let ts = m.timestamp;
          if (ts && typeof ts.toDate === "function") {
            ts = ts.toDate().getTime();
          } else if (ts && typeof ts.seconds === "number") {
            ts = ts.seconds * 1000;
          } else if (typeof ts === "string") {
            const n = Number(ts);
            ts = !isNaN(n) && n > 1000000000 ? n : ts;
          } else if (!ts) {
            ts = Date.now();
          }
          return {
            ...m,
            timestamp: ts
          };
        });
      }
      result.push(data);
    });
    return result;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/chats`);
    return [];
  }
}

export async function saveProjectToFirestore(project: any): Promise<void> {
  const user = auth?.currentUser;
  if (!user || !db || !project || !project.id) return;
  try {
    const projDocRef = doc(db, "users", user.uid, "projects", String(project.id));
    const dataToSave = sanitizeForFirestore({
      id: String(project.id),
      userId: user.uid,
      name: project.name || "Untitled Project",
      description: project.description || "",
      instructions: project.instructions || "",
      chatIds: Array.isArray(project.chatIds) ? project.chatIds : [],
      files: Array.isArray(project.files) ? sanitizeForFirestore(project.files) : [],
      updatedAt: String(project.updatedAt || Date.now()),
      createdAt: String(project.createdAt || Date.now())
    });
    await setDoc(projDocRef, dataToSave, { merge: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}/projects/${project.id}`);
  }
}

export async function deleteProjectFromFirestore(projectId: string): Promise<void> {
  const user = auth?.currentUser;
  if (!user || !db || !projectId) return;
  try {
    const projDocRef = doc(db, "users", user.uid, "projects", String(projectId));
    await deleteDoc(projDocRef);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}/projects/${projectId}`);
  }
}

export async function getProjectsFromFirestore(): Promise<any[]> {
  const user = auth?.currentUser;
  if (!user || !db) return [];
  try {
    const projCol = collection(db, "users", user.uid, "projects");
    const snapshot = await getDocs(projCol);
    const result: any[] = [];
    snapshot.forEach((d) => {
      result.push(d.data());
    });
    return result;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, `users/${user.uid}/projects`);
    return [];
  }
}

// ----------------------------------------------------------------------
// EXPOSE GLOBALLY ON WINDOW FOR VANILLA APP.JS INTERFACE
// ----------------------------------------------------------------------
const NivoraAuthAPI = {
  isReady: false,
  readyPromise,
  initFirebase,
  getCurrentUser,
  getFirebaseUser,
  loginWithEmail,
  signupWithEmail,
  loginWithGoogle,
  resetPassword,
  verifyResetCode,
  confirmNewPassword,
  signOut,
  onAuthState,
  formatAuthError,
  checkEmailPasswordProviderStatus,
  toNivoraUser,
  saveUserProfileToFirestore,
  getUserProfileFromFirestore,
  saveChatToFirestore,
  deleteChatFromFirestore,
  getChatsFromFirestore,
  saveProjectToFirestore,
  deleteProjectFromFirestore,
  getProjectsFromFirestore
};

(window as any).NivoraAuth = NivoraAuthAPI;

// Boot Firebase immediately on module execution
initFirebase()
  .then(() => {
    NivoraAuthAPI.isReady = true;
  })
  .catch((err) => {
    console.error("Firebase init failed:", err);
    resolveReady();
  });

export default NivoraAuthAPI;
