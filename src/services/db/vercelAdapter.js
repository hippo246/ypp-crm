/**
 * /services/db/vercelAdapter.js
 * Vercel Postgres / KV adapter stub.
 * Replace BASE_URL with your actual Vercel API routes.
 *
 * Expected API routes (create these in /api/):
 *   GET    /api/db?collection=leads
 *   GET    /api/db?collection=leads&id=L001
 *   POST   /api/db        { collection, data }
 *   PUT    /api/db        { collection, id, data }
 *   DELETE /api/db        { collection, id }
 */

const BASE_URL = "/api/db";

async function request(method, body, params) {
  const url = params
    ? `${BASE_URL}?${new URLSearchParams(params)}`
    : BASE_URL;

  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[vercelAdapter] ${method} ${url} failed: ${res.status} ${text}`);
  }

  return res.json();
}

export const vercelAdapter = {
  async getAll(collection) {
    return request("GET", null, { collection });
  },
  async getById(collection, id) {
    return request("GET", null, { collection, id });
  },
  async create(collection, data) {
    return request("POST", { collection, data });
  },
  async update(collection, id, data) {
    return request("PUT", { collection, id, data });
  },
  async delete(collection, id) {
    return request("DELETE", { collection, id });
  },
  async applyMutation(mutation) {
    const { type, collection, id, data } = mutation;
    switch (type) {
      case "create": return vercelAdapter.create(collection, data);
      case "update": return vercelAdapter.update(collection, id, data);
      case "delete": return vercelAdapter.delete(collection, id);
      default: throw new Error(`[vercelAdapter] unknown mutation type: ${type}`);
    }
  },
};
