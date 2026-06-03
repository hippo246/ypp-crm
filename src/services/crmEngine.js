/**
 * crmEngine.js
 * Pure functions for leads / pipeline / scoring business logic.
 */

// ─── Lead scoring ──────────────────────────────────────────────────────────────

const SOURCE_SCORE = {
  Referral: 30,
  "Walk-in": 25,
  Google: 20,
  Facebook: 15,
  Instagram: 10,
  Other: 5,
};

const STATUS_SCORE = {
  New: 0,
  Contacted: 10,
  Qualified: 25,
  Proposal: 40,
  Won: 60,
  Lost: 0,
};

const VALUE_TIERS = [
  { min: 50000, score: 30 },
  { min: 20000, score: 20 },
  { min: 10000, score: 10 },
  { min: 0, score: 5 },
];

export function scoreLead(lead) {
  if (!lead) return 0;
  const src = SOURCE_SCORE[lead.source] ?? 5;
  const st = STATUS_SCORE[lead.status] ?? 0;
  const tier = VALUE_TIERS.find((t) => (lead.value ?? 0) >= t.min);
  const val = tier?.score ?? 0;
  return Math.min(src + st + val, 100);
}

export function scoreLabel(score) {
  if (score >= 70) return "Hot";
  if (score >= 40) return "Warm";
  return "Cold";
}

// ─── Duplicate detection ───────────────────────────────────────────────────────

function normalise(str = "") {
  return str.toLowerCase().replace(/\s+/g, "");
}

export function findDuplicates(leads) {
  const safe = (leads || []).filter(Boolean);
  const byEmail = new Map(), byPhone = new Map(), byName = new Map();
  const dupes = new Set();

  for (const lead of safe) {
    const email = lead.email ? normalise(lead.email) : null;
    const phone = lead.phone ? normalise(lead.phone) : null;
    const name  = lead.name  ? normalise(lead.name)  : null;

    if (email) {
      if (byEmail.has(email)) { dupes.add(byEmail.get(email)); dupes.add(lead.id); }
      else byEmail.set(email, lead.id);
    }
    if (phone) {
      if (byPhone.has(phone)) { dupes.add(byPhone.get(phone)); dupes.add(lead.id); }
      else byPhone.set(phone, lead.id);
    }
    if (name) {
      if (byName.has(name)) { dupes.add(byName.get(name)); dupes.add(lead.id); }
      else byName.set(name, lead.id);
    }
  }
  return dupes;
}

// ─── Pipeline stats ────────────────────────────────────────────────────────────

const PIPELINE_STAGES = ["New", "Contacted", "Qualified", "Proposal", "Won", "Lost"];

export function getPipelineStats(leads) {
  const safe = (leads || []).filter(Boolean);
  return PIPELINE_STAGES.map((stage) => {
    const stageLeads = safe.filter((l) => l.status === stage);
    return {
      stage,
      count: stageLeads.length,
      value: stageLeads.reduce((s, l) => s + (l.value ?? 0), 0),
    };
  });
}

export function getConversionRate(leads) {
  const safe = (leads || []).filter(Boolean);
  const closed = safe.filter((l) => ["Won", "Lost"].includes(l.status)).length;
  if (!closed) return 0;
  const won = safe.filter((l) => l.status === "Won").length;
  return Math.round((won / closed) * 100);
}

export function getWonValue(leads) {
  return (leads || []).filter(Boolean).filter((l) => l.status === "Won").reduce((s, l) => s + (l.value ?? 0), 0);
}

// ─── Follow-up reminders ───────────────────────────────────────────────────────

export function getStaleLeads(leads, staleDays = 7) {
  const safe = (leads || []).filter(Boolean);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - staleDays);
  const cutoffTime = cutoff.getTime();
  return safe.filter(
    (l) =>
      !["Won", "Lost"].includes(l.status) &&
      new Date(l.updatedAt ?? l.date ?? 0).getTime() < cutoffTime
  );
}

// ─── Lost reason analysis ──────────────────────────────────────────────────────

export function getLostReasons(leads) {
  const map = {};
  (leads || []).filter(Boolean)
    .filter((l) => l.status === "Lost" && l.lostReason != null)
    .forEach((l) => {
      map[l.lostReason] = (map[l.lostReason] ?? 0) + 1;
    });
  return Object.entries(map)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

export { PIPELINE_STAGES };
