import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// This is intentionally the same document used by the existing Trazo frontend.
// Keep all Firebase Admin credentials in the Vercel SERVER environment only.
export async function workspace() {
  const raw = process.env.TRAZZO_FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Firebase server credential is not configured.");
  const serviceAccount = JSON.parse(raw);
  if (serviceAccount.project_id !== "trazzo-c9eaf") {
    throw new Error("Incorrect Firebase project: expected trazzo-c9eaf.");
  }
  const app = getApps().length ? getApp() : initializeApp({ credential: cert(serviceAccount) });
  const snapshot = await getFirestore(app).collection("workspace").doc("proyectos").get();
  if (!snapshot.exists) throw new Error("Trazo workspace document not found.");
  return snapshot.data() || {};
}
