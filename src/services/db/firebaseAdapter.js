/**
 * /services/db/firebaseAdapter.js
 * Firebase Firestore adapter stub.
 *
 * Setup:
 *   npm install firebase
 *   Fill in firebaseConfig below with your project credentials.
 *   Uncomment the imports and implementation.
 */

// import { initializeApp } from "firebase/app";
// import { getFirestore, collection, doc, getDocs, getDoc, addDoc, updateDoc, deleteDoc } from "firebase/firestore";

// const firebaseConfig = {
//   apiKey: "YOUR_API_KEY",
//   authDomain: "YOUR_PROJECT.firebaseapp.com",
//   projectId: "YOUR_PROJECT_ID",
// };

// const app = initializeApp(firebaseConfig);
// const db  = getFirestore(app);

export const firebaseAdapter = {
  async getAll(col) {
    // const snap = await getDocs(collection(db, col));
    // return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    throw new Error("[firebaseAdapter] not configured — fill in firebaseConfig");
  },
  async getById(col, id) {
    // const snap = await getDoc(doc(db, col, id));
    // return snap.exists() ? { id: snap.id, ...snap.data() } : null;
    throw new Error("[firebaseAdapter] not configured");
  },
  async create(col, data) {
    // const ref = await addDoc(collection(db, col), data);
    // return { id: ref.id, ...data };
    throw new Error("[firebaseAdapter] not configured");
  },
  async update(col, id, data) {
    // await updateDoc(doc(db, col, id), data);
    // return { id, ...data };
    throw new Error("[firebaseAdapter] not configured");
  },
  async delete(col, id) {
    // await deleteDoc(doc(db, col, id));
    throw new Error("[firebaseAdapter] not configured");
  },
  async applyMutation(mutation) {
    const { type, collection, id, data } = mutation;
    switch (type) {
      case "create": return firebaseAdapter.create(collection, data);
      case "update": return firebaseAdapter.update(collection, id, data);
      case "delete": return firebaseAdapter.delete(collection, id);
      default: throw new Error(`[firebaseAdapter] unknown mutation type: ${type}`);
    }
  },
};
