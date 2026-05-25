/**
 * /services/db/localAdapter.js
 * localStorage-backed adapter. Zero dependencies, works offline.
 * Data persists across page refreshes.
 */

const PREFIX = "crm_db_";

function storageKey(collection) {
  return `${PREFIX}${collection}`;
}

function readCollection(collection) {
  try {
    const raw = localStorage.getItem(storageKey(collection));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeCollection(collection, items) {
  try {
    localStorage.setItem(storageKey(collection), JSON.stringify(items));
  } catch (e) {
    console.warn("[localAdapter] write failed:", e);
  }
}

export const localAdapter = {
  async getAll(collection) {
    return readCollection(collection);
  },

  async getById(collection, id) {
    const items = readCollection(collection);
    return items.find((item) => item.id === id) ?? null;
  },

  async create(collection, data) {
    const items = readCollection(collection);
    const newItem = { ...data, _createdAt: new Date().toISOString() };
    items.push(newItem);
    writeCollection(collection, items);
    return newItem;
  },

  async update(collection, id, data) {
    const items = readCollection(collection);
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) throw new Error(`[localAdapter] ${collection}/${id} not found`);
    items[index] = { ...items[index], ...data, _updatedAt: new Date().toISOString() };
    writeCollection(collection, items);
    return items[index];
  },

  async delete(collection, id) {
    const items = readCollection(collection);
    const filtered = items.filter((item) => item.id !== id);
    writeCollection(collection, filtered);
  },

  async applyMutation(mutation) {
    const { type, collection, id, data } = mutation;
    switch (type) {
      case "create": return localAdapter.create(collection, data);
      case "update": return localAdapter.update(collection, id, data);
      case "delete": return localAdapter.delete(collection, id);
      default: throw new Error(`[localAdapter] unknown mutation type: ${type}`);
    }
  },

  async seed(data) {
    for (const [collection, items] of Object.entries(data)) {
      const existing = readCollection(collection);
      if (existing.length === 0 && Array.isArray(items)) {
        writeCollection(collection, items);
      }
    }
  },

  async exportAll() {
    const collections = ["leads","clients","tasks","accounting","inventory","suppliers"];
    const result = {};
    for (const col of collections) result[col] = readCollection(col);
    return result;
  },

  /** Dev utility — nuke everything */
  async clearAll() {
    const collections = ["leads","clients","tasks","accounting","inventory","suppliers"];
    collections.forEach((col) => localStorage.removeItem(storageKey(col)));
  },
};
