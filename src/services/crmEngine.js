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

export function findDuplicates(leads = []) {
  const dupes = new Set();
  for (let i = 0; i < leads.length; i++) {
    for (let j = i + 1; j < leads.length; j++) {
      const a = leads[i];
      const b = leads[j];
      const emailMatch = a.email && b.email && normalise(a.email) === normalise(b.email);
      const phoneMatch = a.phone && b.phone && normalise(a.phone) === normalise(b.phone);
      const nameMatch =
        a.name && b.name && normalise(a.name) === normalise(b.name);
      if (emailMatch || phoneMatch || nameMatch) {
        dupes.add(a.id);
        dupes.add(b.id);
      }
    }
  }
  return dupes;
}

// ─── Pipeline stats ────────────────────────────────────────────────────────────

const PIPELINE_STAGES = ["New", "Contacted", "Qualified", "Proposal", "Won", "Lost"];

export function getPipelineStats(leads = []) {
  return PIPELINE_STAGES.map((stage) => {
    const stageLeads = leads.filter((l) => l.status === stage);
    return {
      stage,
      count: stageLeads.length,
      value: stageLeads.reduce((s, l) => s + (l.value ?? 0), 0),
    };
  });
}

export function getConversionRate(leads = []) {
  const closed = leads.filter((l) => ["Won", "Lost"].includes(l.status)).length;
  if (!closed) return 0;
  const won = leads.filter((l) => l.status === "Won").length;
  return Math.round((won / closed) * 100);
}

export function getWonValue(leads = []) {
  return leads.filter((l) => l.status === "Won").reduce((s, l) => s + (l.value ?? 0), 0);
}

// ─── Follow-up reminders ───────────────────────────────────────────────────────

/**
 * Returns leads that haven't been updated in `staleDays` days and are still open.
 */
export function getStaleLeads(leads = [], staleDays = 7) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - staleDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return leads.filter(
    (l) =>
      !["Won", "Lost"].includes(l.status) &&
      (l.updatedAt ?? l.date ?? "") < cutoffStr
  );
}

// ─── Lost reason analysis ──────────────────────────────────────────────────────

export function getLostReasons(leads = []) {
  const map = {};
  leads
    .filter((l) => l.status === "Lost" && l.lostReason)
    .forEach((l) => {
      map[l.lostReason] = (map[l.lostReason] ?? 0) + 1;
    });
  return Object.entries(map)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

export { PIPELINE_STAGES };
