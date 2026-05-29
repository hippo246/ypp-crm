export const aed = (n) => `AED ${Number(n).toLocaleString()}`;

export const initials = (name) =>
  name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

export const avatarColor = (name) => {
  const colors = ["#1D3557", "#457B9D", "#E63946", "#16A34A", "#EA580C", "#7C3AED", "#0F766E"];
  let h = 0;
  for (let c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(h) % colors.length];
};

export const filterSearch = (rows, search, keys) => {
  if (!search.trim()) return rows;
  const q = search.toLowerCase();
  return rows.filter((r) => keys.some((k) => String(r[k] || "").toLowerCase().includes(q)));
};

export const nextId = (prefix) => prefix + String(Date.now()).slice(-4);

/**
 * parseOperatorQuery — parses a search string into free text + field:value filters.
 * e.g. "status:active John" → { free: "John", filters: [{ field: "status", value: "active" }] }
 */
export function parseOperatorQuery(query = "") {
  const filters = [];
  const free = query
    .replace(/(\w+):(\S+)/g, (_, field, value) => {
      filters.push({ field, value });
      return "";
    })
    .trim();
  return { free, filters };
}
