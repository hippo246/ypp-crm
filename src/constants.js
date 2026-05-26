// ─── BRAND COLORS ────────────────────────────────────────────────────────────
export const B = {
  blue:   "#2563EB",   // vivid electric blue (was dark navy)
  red:    "#EF4444",
  yellow: "#F59E0B",
  accent: "#6366F1",   // indigo accent
  light:  "#F1F5F9",
  border: "#E2E8F0",
  text:   "#0F172A",
  muted:  "#64748B",
  bg:     "#F8FAFC",
  white:  "#FFFFFF",
  green:  "#10B981",   // emerald
  orange: "#F97316",
  // new glow helpers used by components
  blueGlow:   "rgba(37,99,235,0.18)",
  greenGlow:  "rgba(16,185,129,0.18)",
  redGlow:    "rgba(239,68,68,0.18)",
  purpleGlow: "rgba(99,102,241,0.18)",
};

// ─── STATUS COLORS ───────────────────────────────────────────────────────────
export const STATUS_COLORS = {
  New:         { bg: "#DBEAFE", text: "#1D4ED8", glow: "rgba(37,99,235,0.2)" },
  Contacted:   { bg: "#D1FAE5", text: "#059669", glow: "rgba(16,185,129,0.2)" },
  Qualified:   { bg: "#FEF3C7", text: "#D97706", glow: "rgba(245,158,11,0.2)" },
  Proposal:    { bg: "#EDE9FE", text: "#7C3AED", glow: "rgba(124,58,237,0.2)" },
  Won:         { bg: "#D1FAE5", text: "#059669", glow: "rgba(16,185,129,0.25)" },
  Lost:        { bg: "#FEE2E2", text: "#DC2626", glow: "rgba(239,68,68,0.2)" },
  Active:      { bg: "#D1FAE5", text: "#059669", glow: "rgba(16,185,129,0.2)" },
  Pending:     { bg: "#FEF3C7", text: "#D97706", glow: "rgba(245,158,11,0.2)" },
  Expired:     { bg: "#FEE2E2", text: "#DC2626", glow: "rgba(239,68,68,0.2)" },
  Paid:        { bg: "#D1FAE5", text: "#059669", glow: "rgba(16,185,129,0.2)" },
  Partial:     { bg: "#FFEDD5", text: "#EA580C", glow: "rgba(249,115,22,0.2)" },
  Unpaid:      { bg: "#FEF3C7", text: "#D97706", glow: "rgba(245,158,11,0.2)" },
  Overdue:     { bg: "#FEE2E2", text: "#DC2626", glow: "rgba(239,68,68,0.25)" },
  "In Stock":  { bg: "#D1FAE5", text: "#059669", glow: "rgba(16,185,129,0.2)" },
  "Low Stock": { bg: "#FFEDD5", text: "#EA580C", glow: "rgba(249,115,22,0.2)" },
  Critical:    { bg: "#FEE2E2", text: "#DC2626", glow: "rgba(239,68,68,0.25)" },
  High:        { bg: "#FEE2E2", text: "#DC2626", glow: "rgba(239,68,68,0.2)" },
  Medium:      { bg: "#FFEDD5", text: "#EA580C", glow: "rgba(249,115,22,0.2)" },
  Low:         { bg: "#D1FAE5", text: "#059669", glow: "rgba(16,185,129,0.2)" },
  Done:        { bg: "#D1FAE5", text: "#059669", glow: "rgba(16,185,129,0.2)" },
  "In Progress":{ bg: "#DBEAFE", text: "#2563EB", glow: "rgba(37,99,235,0.2)" },
  "In Review": { bg: "#EDE9FE", text: "#7C3AED", glow: "rgba(124,58,237,0.2)" },
  "Blocked":   { bg: "#FEE2E2", text: "#DC2626", glow: "rgba(239,68,68,0.25)" },
  "Recurring": { bg: "#ECFDF5", text: "#059669", glow: "rgba(16,185,129,0.2)" },
  "Milestone": { bg: "#FFF7ED", text: "#EA580C", glow: "rgba(249,115,22,0.2)" },
};

// ─── SEED DATA ────────────────────────────────────────────────────────────────
export const INIT = {
  leads: [
    { id: "L001", name: "Juan dela Cruz", email: "juan@gmail.com", phone: "+971 50 123 4567", service: "UAE Visa", status: "New", value: 3500, source: "Facebook", date: "2025-05-20", notes: "Ready to proceed" },
    { id: "L002", name: "Maria Santos", email: "maria@yahoo.com", phone: "+971 55 234 5678", service: "Business License", status: "Contacted", value: 12000, source: "Google", date: "2025-05-19", notes: "Called 2x, awaiting docs" },
    { id: "L003", name: "Carlo Reyes", email: "carlo@gmail.com", phone: "+971 52 345 6789", service: "Employment Visa", status: "Qualified", value: 5200, source: "Referral", date: "2025-05-18", notes: "Referred by Bautista" },
    { id: "L004", name: "Ana Flores", email: "ana@gmail.com", phone: "+971 56 456 7890", service: "UAE Visa", status: "Proposal", value: 3800, source: "Instagram", date: "2025-05-17", notes: "Proposal sent" },
    { id: "L005", name: "Pedro Lim", email: "pedro@gmail.com", phone: "+971 54 567 8901", service: "Business Setup", status: "Won", value: 18000, source: "Google", date: "2025-05-15", notes: "Converted to client" },
    { id: "L006", name: "Rosa Mercado", email: "rosa@yahoo.com", phone: "+971 50 678 9012", service: "UAE Visa", status: "Lost", value: 3200, source: "Facebook", date: "2025-05-14", notes: "Went with competitor" },
    { id: "L007", name: "Tony Villanueva", email: "tony@gmail.com", phone: "+971 58 789 0123", service: "Business License", status: "New", value: 9000, source: "Walk-in", date: "2025-05-21", notes: "" },
  ],
  clients: [
    { id: "C001", name: "Bautista Trading LLC", contact: "Jose Bautista", email: "jose@bautista.ae", phone: "+971 4 234 5678", service: "Business License", status: "Active", value: 24000, started: "2024-03-01", renewal: "2025-03-01", progress: 75 },
    { id: "C002", name: "Santos Recruitment", contact: "Maria Santos", email: "maria@santos.ae", phone: "+971 4 345 6789", service: "Employment Visa", status: "Active", value: 45000, started: "2024-01-15", renewal: "2025-01-15", progress: 90 },
    { id: "C003", name: "Cruz Enterprises", contact: "Pedro Cruz", email: "pedro@cruz.ae", phone: "+971 4 456 7890", service: "Business Setup", status: "Pending", value: 18500, started: "2025-04-01", renewal: "2026-04-01", progress: 30 },
    { id: "C004", name: "Reyes Trading Co.", contact: "Ana Reyes", email: "ana@reyes.ae", phone: "+971 4 567 8901", service: "Business License", status: "Active", value: 12000, started: "2024-06-01", renewal: "2025-06-01", progress: 60 },
    { id: "C005", name: "Pinoy Foods FZE", contact: "Carlo Pinoy", email: "carlo@pinoyfood.ae", phone: "+971 4 678 9012", service: "Freezone License", status: "Expired", value: 9500, started: "2023-05-01", renewal: "2024-05-01", progress: 100 },
  ],
  tasks: [
    { id: "T001", title: "Follow up — Juan dela Cruz visa docs", assigned: "Anna", reviewAssignee: "", team: [], priority: "High", status: "Pending", due: "2025-05-24", start: "2025-05-20", ref: "L001", progress: 20, risk: "High", subtasks: [], dependsOn: [], recurring: null, milestone: false, notes: "", comments: [], attachments: [], activityLog: [], bottleneck: false, approvalStatus: null },
    { id: "T002", title: "Submit Business License for Bautista Trading", assigned: "Mark", reviewAssignee: "Anna", team: ["Mark","Anna"], priority: "High", status: "In Progress", due: "2025-05-25", start: "2025-05-22", ref: "C001", progress: 60, risk: "Medium", subtasks: [{ id: "ST001", title: "Gather docs", done: true }, { id: "ST002", title: "Submit to authority", done: false }], dependsOn: [], recurring: null, milestone: true, notes: "Priority client", comments: [], attachments: [], activityLog: [], bottleneck: false, approvalStatus: "Pending" },
    { id: "T003", title: "Call Maria Santos re: employment visa", assigned: "Anna", reviewAssignee: "", team: ["Anna"], priority: "Medium", status: "Pending", due: "2025-05-26", start: "2025-05-25", ref: "C002", progress: 0, risk: "Low", subtasks: [], dependsOn: ["T002"], recurring: "weekly", milestone: false, notes: "", comments: [], attachments: [], activityLog: [], bottleneck: false, approvalStatus: null },
    { id: "T004", title: "Prepare proposal for Cruz Enterprises", assigned: "James", reviewAssignee: "Mark", team: ["James"], priority: "Medium", status: "Done", due: "2025-05-22", start: "2025-05-20", ref: "C003", progress: 100, risk: "Low", subtasks: [], dependsOn: [], recurring: null, milestone: false, notes: "", comments: [{ id: "CM001", author: "Mark", text: "Looks good!", time: "2025-05-22T10:00:00Z", mentions: [] }], attachments: [], activityLog: [], bottleneck: false, approvalStatus: "Approved" },
    { id: "T005", title: "Renew Pinoy Foods FZE license", assigned: "Mark", reviewAssignee: "", team: ["Mark","James"], priority: "High", status: "Pending", due: "2025-05-28", start: "2025-05-26", ref: "C005", progress: 10, risk: "High", subtasks: [], dependsOn: [], recurring: null, milestone: true, notes: "License expiring soon", comments: [], attachments: [], activityLog: [], bottleneck: true, approvalStatus: null },
    { id: "T006", title: "Upload visa copies to drive", assigned: "Anna", reviewAssignee: "", team: [], priority: "Low", status: "Done", due: "2025-05-21", start: "2025-05-21", ref: "", progress: 100, risk: "Low", subtasks: [], dependsOn: [], recurring: null, milestone: false, notes: "", comments: [], attachments: [], activityLog: [], bottleneck: false, approvalStatus: null },
    { id: "T007", title: "Send invoice reminder — Reyes Trading", assigned: "James", reviewAssignee: "", team: ["James"], priority: "Medium", status: "Pending", due: "2025-05-29", start: "2025-05-27", ref: "C004", progress: 0, risk: "Medium", subtasks: [], dependsOn: ["T004"], recurring: "monthly", milestone: false, notes: "", comments: [], attachments: [], activityLog: [], bottleneck: false, approvalStatus: null },
  ],
  accounting: [
    { id: "INV001", client: "Bautista Trading LLC", desc: "Business License Renewal", amount: 24000, paid: 12000, status: "Partial", date: "2025-05-01", due: "2025-06-01" },
    { id: "INV002", client: "Santos Recruitment", desc: "Employment Visa — Batch 5", amount: 45000, paid: 45000, status: "Paid", date: "2025-04-15", due: "2025-05-15" },
    { id: "INV003", client: "Cruz Enterprises", desc: "Business Setup Package", amount: 18500, paid: 5000, status: "Partial", date: "2025-05-10", due: "2025-06-10" },
    { id: "INV004", client: "Reyes Trading Co.", desc: "Business License", amount: 12000, paid: 0, status: "Unpaid", date: "2025-05-20", due: "2025-06-20" },
    { id: "INV005", client: "Walk-in Client", desc: "UAE Tourist Visa", amount: 3500, paid: 3500, status: "Paid", date: "2025-05-22", due: "2025-05-22" },
    { id: "INV006", client: "Pinoy Foods FZE", desc: "Freezone License Renewal", amount: 9500, paid: 0, status: "Overdue", date: "2025-04-01", due: "2025-05-01" },
  ],
  inventory: [
    { id: "I001", name: "Visa Application Form (UAE)", category: "Forms", qty: 450, unit: "pcs", reorder: 100, cost: 0.5, supplier: "S001", status: "In Stock" },
    { id: "I002", name: "Business License Template Pack", category: "Digital", qty: 12, unit: "pcs", reorder: 5, cost: 50, supplier: "S002", status: "In Stock" },
    { id: "I003", name: "Document Folder (Branded)", category: "Supplies", qty: 38, unit: "pcs", reorder: 50, cost: 8, supplier: "S003", status: "Low Stock" },
    { id: "I004", name: "Stamp Ink Pad", category: "Supplies", qty: 3, unit: "pcs", reorder: 5, cost: 25, supplier: "S003", status: "Low Stock" },
    { id: "I005", name: "A4 Paper Ream", category: "Supplies", qty: 22, unit: "reams", reorder: 10, cost: 18, supplier: "S003", status: "In Stock" },
    { id: "I006", name: "Printer Toner (Black)", category: "Supplies", qty: 1, unit: "pcs", reorder: 3, cost: 120, supplier: "S003", status: "Critical" },
  ],
  suppliers: [
    { id: "S001", name: "Al Fardan Exchange", contact: "Ahmed Al Fardan", email: "ahmed@alfardan.ae", phone: "+971 4 234 5678", category: "Government Forms", status: "Active", terms: "Net 30", balance: 0 },
    { id: "S002", name: "UAE Business Solutions", contact: "Khalid Hassan", email: "khalid@uaebs.ae", phone: "+971 4 345 6789", category: "Digital Products", status: "Active", terms: "Net 15", balance: 1200 },
    { id: "S003", name: "Gulf Office Supplies", contact: "Raj Patel", email: "raj@gulfofc.ae", phone: "+971 4 456 7890", category: "Office Supplies", status: "Active", terms: "Net 30", balance: 850 },
    { id: "S004", name: "DHL Express UAE", contact: "Sarah Lee", email: "sarah@dhl.ae", phone: "+971 4 567 8901", category: "Courier", status: "Active", terms: "COD", balance: 0 },
  ],
};
