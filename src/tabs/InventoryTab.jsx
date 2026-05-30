import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { aed, filterSearch, nextId, parseOperatorQuery } from "../helpers";
import { useTableFilterV2, useSortedData, usePagination, useSearchSuggestions } from "../hooks";
import { useAppData } from "../context/AppContext";
import workflowEngine from "../services/workflowEngine";
import { useMultiUserSync } from "../hooks/useMultiUserSync";
import { toast } from "../App";
import { B } from "../constants";
import Badge from "../components/Badge";
import SectionCard from "../components/SectionCard";
import NTable from "../components/NTable";
import ExcelTable from "../components/ExcelTable";
import FormModal from "../components/FormModal";

// ─── Fun Layer: Inventory Edition ────────────────────────────────────────────

const INV_VIBES = [
  { hour: [6,11],  emoji: "📦", msg: "Morning stock check. Let's see what we're working with." },
  { hour: [11,14], emoji: "🏭", msg: "Midday logistics crunch. You're basically a warehouse wizard." },
  { hour: [14,17], emoji: "🔍", msg: "Afternoon audit. Somebody's gotta count the reams." },
  { hour: [17,20], emoji: "🌆", msg: "End of day — did you reorder the critical stuff? Did you??" },
  { hour: [20,24], emoji: "🌙", msg: "Night shift inventory check. Dedication. Or desperation." },
  { hour: [0,6],   emoji: "🦉", msg: "Counting stock at 3am. We don't judge. Actually we do." },
];

const ADD_TOASTS = [
  "📦 New item catalogued. The warehouse gods are pleased.",
  "🗂️ Stock entry created. Very organized of you.",
  "✅ Added to inventory. One step closer to supply chain glory.",
  "🏷️ Tagged and shelved. Marie Kondo would approve.",
  "📋 Item registered. You're basically a logistics CEO.",
  "🧾 Logged! Your future self will thank you.",
  "📬 Inventory updated. Someone's on top of things.",
  "⚡ New stock entry. The spreadsheet fears you.",
  "🗃️ Catalogued. You just out-organized an entire supply chain team.",
  "🎯 Item added. Precision. Purpose. Power.",
];

const REORDER_TOASTS = [
  "↺ Reorder task created. Crisis averted — barely.",
  "🚨 Restocking initiated. The shelves will survive another day.",
  "📮 Reorder queued. Someone's being proactive. Suspicious.",
  "🔔 Task flagged for restock. Your inventory is calling for backup.",
  "📦 Reorder triggered. The supply chain thanks you for caring.",
  "⚠️ Low stock handled. You noticed before it became a disaster.",
  "🛒 Restocking task sent. The supplier is about to have a good day.",
  "🔄 Cycle continues. Item restocked in task queue.",
  "💡 Reorder created. That's the kind of foresight consultants charge for.",
  "📣 Task raised. You run a tight ship. A very tight ship.",
];

const EDIT_TOASTS = [
  "✏️ Record updated. Accuracy is a virtue.",
  "🔧 Item tweaked. Small adjustments, big impact.",
  "📝 Edit saved. The inventory gods note your diligence.",
  "⚙️ Updated. You just out-pedanted every auditor in the building.",
  "🔄 Changes locked in. Clean data, clean conscience.",
];

const INV_ACHIEVEMENTS = [
  { id: "inv_first",      icon: "📦", title: "First Stock",        desc: "Added your first inventory item",                       check: (inv) => inv.length >= 1 },
  { id: "inv_ten",        icon: "🗂️", title: "Stacked Shelves",    desc: "10+ items in inventory",                                check: (inv) => inv.length >= 10 },
  { id: "inv_reorder",    icon: "🔄", title: "Restocking Pro",     desc: "Triggered your first reorder task",                     check: (inv, tasks) => (tasks||[]).some(t => t.title?.startsWith("Reorder:")) },
  { id: "inv_clean",      icon: "✨", title: "All Clear",          desc: "Every item is In Stock — no low or critical",           check: (inv) => inv.length > 0 && inv.every(i => i.status === "In Stock") },
  { id: "inv_critical",   icon: "🚨", title: "Crisis Manager",     desc: "Had a Critical stock item and survived",                check: (inv) => inv.some(i => i.status === "Critical") },
  { id: "inv_categories", icon: "🏷️", title: "Diversified",       desc: "Items across all 4 categories",                        check: (inv) => new Set(inv.map(i => i.category)).size >= 4 },
  { id: "inv_supplier5",  icon: "🤝", title: "Supplier Network",   desc: "Items from 5+ different suppliers",                     check: (inv) => new Set(inv.map(i => i.supplier).filter(Boolean)).size >= 5 },
  { id: "inv_hoarder",    icon: "🏭", title: "GOD OF STOCK",       desc: "50+ items catalogued — you run a warehouse now",        check: (inv) => inv.length >= 50 },
];

function spawnConfetti(x, y) {
  const colors = ["#f59e0b","#10b981","#3b82f6","#8b5cf6","#ef4444","#ec4899","#06b6d4"];
  const container = document.createElement("div");
  container.style.cssText = `position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:99999;overflow:hidden`;
  document.body.appendChild(container);
  for (let i = 0; i < 60; i++) {
    const el = document.createElement("div");
    const color = colors[Math.floor(Math.random() * colors.length)];
    const size  = 6 + Math.random() * 8;
    const angle = Math.random() * 360;
    const vx    = (Math.random() - 0.5) * 400;
    const vy    = -200 - Math.random() * 300;
    el.style.cssText = `position:absolute;width:${size}px;height:${size}px;background:${color};
      left:${x}px;top:${y}px;border-radius:${Math.random() > 0.5 ? "50%" : "2px"};
      transform:rotate(${angle}deg);opacity:1;transition:none`;
    container.appendChild(el);
    const start = performance.now();
    const dur   = 900 + Math.random() * 600;
    const spin  = (Math.random() - 0.5) * 720;
    const animate = (now) => {
      const t = Math.min((now - start) / dur, 1);
      el.style.left      = `${x + vx * t}px`;
      el.style.top       = `${y + (vy * t + 300 * t * t)}px`;
      el.style.opacity   = String(1 - t);
      el.style.transform = `rotate(${angle + spin * t}deg)`;
      if (t < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }
  setTimeout(() => document.body.removeChild(container), 1600);
}

function useToasts() {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, icon = "📦", type = "add", title = null) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t.slice(-3), { id, msg, icon, type, title }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3500);
  }, []);
  return { toasts, push };
}

function ToastStack({ toasts }) {
  return (
    <div style={{ position:"fixed", bottom:24, right:24, zIndex:99998, display:"flex", flexDirection:"column", gap:8, pointerEvents:"none" }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type === "achievement" ? "linear-gradient(135deg,#1e293b,#0f172a)" : "#1e293b",
          color:"#fff", padding:"12px 18px", borderRadius:12,
          fontSize:13, fontWeight:600, maxWidth:320,
          boxShadow:"0 8px 32px rgba(0,0,0,0.35)",
          borderLeft: t.type === "achievement" ? "4px solid #f59e0b" : "4px solid #10b981",
          animation:"slideInRight 0.3s ease",
          display:"flex", alignItems:"center", gap:10,
        }}>
          <span style={{ fontSize:20 }}>{t.icon}</span>
          <div>
            {t.title && <div style={{ fontSize:11, fontWeight:700, color:"#f59e0b", textTransform:"uppercase", letterSpacing:0.5, marginBottom:2 }}>{t.title}</div>}
            {t.msg}
          </div>
        </div>
      ))}
      <style>{`@keyframes slideInRight{from{transform:translateX(120%);opacity:0}to{transform:translateX(0);opacity:1}}`}</style>
    </div>
  );
}

function useXP(storageKey = "inv_xp") {
  const [xp, setXP] = useState(() => Number(localStorage.getItem(storageKey)) || 0);
  const gain = useCallback((amount) => {
    setXP(prev => {
      const next = prev + amount;
      localStorage.setItem(storageKey, String(next));
      return next;
    });
  }, [storageKey]);
  return { xp, gain };
}

function XPBar({ xp }) {
  const level  = Math.floor(xp / 100) + 1;
  const pct    = xp % 100;
  const titles = ["Intern","Junior","Analyst","Senior","Manager","Director","VP","C-Suite","Legend","GOD MODE"];
  const title  = titles[Math.min(level - 1, titles.length - 1)];
  const colors = ["#94a3b8","#60a5fa","#34d399","#a78bfa","#f59e0b","#f97316","#ef4444","#ec4899","#06b6d4","#fbbf24"];
  const color  = colors[Math.min(level - 1, colors.length - 1)];
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, background:B.white, border:`1px solid ${B.border}`, borderRadius:10, padding:"8px 14px" }}>
      <div style={{ textAlign:"center", minWidth:40 }}>
        <div style={{ fontSize:18, lineHeight:1 }}>📦</div>
        <div style={{ fontSize:9, fontWeight:800, color, letterSpacing:0.5, textTransform:"uppercase" }}>Lv.{level}</div>
      </div>
      <div style={{ flex:1 }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
          <span style={{ fontSize:11, fontWeight:700, color }}>{title}</span>
          <span style={{ fontSize:10, color:B.muted }}>{xp} XP</span>
        </div>
        <div style={{ height:5, background:B.border, borderRadius:99, overflow:"hidden" }}>
          <div style={{ width:`${pct}%`, height:"100%", background:`linear-gradient(90deg,${color},${color}cc)`, borderRadius:99, transition:"width 0.6s ease" }} />
        </div>
        <div style={{ fontSize:9, color:B.muted, marginTop:2 }}>{100 - pct} XP to next level</div>
      </div>
    </div>
  );
}

function AchievementShelf({ inventory, tasks, newlyUnlocked }) {
  const unlocked = INV_ACHIEVEMENTS.filter(a => a.check(inventory, tasks));
  return (
    <div style={{ background:B.white, border:`1px solid ${B.border}`, borderRadius:10, padding:"10px 14px" }}>
      <div style={{ fontSize:10, fontWeight:700, color:B.muted, textTransform:"uppercase", letterSpacing:0.5, marginBottom:8 }}>🏆 Achievements</div>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        {INV_ACHIEVEMENTS.map(a => {
          const done  = a.check(inventory, tasks);
          const isNew = newlyUnlocked.includes(a.id);
          return (
            <div key={a.id} title={`${a.title}: ${a.desc}`} style={{
              width:38, height:38, borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:20, cursor:"default",
              background: done ? (isNew ? "#fef9c3" : B.light) : "#f8fafc",
              border:`1px solid ${done ? (isNew ? "#f59e0b" : B.border) : "#e2e8f0"}`,
              opacity: done ? 1 : 0.3,
              filter: done ? "none" : "grayscale(1)",
              transform: isNew ? "scale(1.15)" : "scale(1)",
              transition:"all 0.3s ease",
              boxShadow: isNew ? "0 0 0 3px #f59e0b40" : "none",
            }}>
              {a.icon}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize:9, color:B.muted, marginTop:6 }}>{unlocked.length}/{INV_ACHIEVEMENTS.length} unlocked — hover for details</div>
    </div>
  );
}

function DailyVibeBar() {
  const h    = new Date().getHours();
  const vibe = INV_VIBES.find(v => h >= v.hour[0] && h < v.hour[1]) || INV_VIBES[0];
  const day  = new Date().toLocaleDateString("en", { weekday:"long" });
  const isMonday = new Date().getDay() === 1;
  const isFriday = new Date().getDay() === 5;
  const bonus = isMonday ? " Monday stock panic is a perfectly valid workflow." : isFriday ? " Friday! Reorder before the weekend, you won't regret it." : "";
  return (
    <div style={{ background:`linear-gradient(135deg,#0f172a,#1e293b)`, borderRadius:10, padding:"10px 16px", display:"flex", alignItems:"center", gap:12 }}>
      <span style={{ fontSize:22 }}>{vibe.emoji}</span>
      <div>
        <div style={{ fontSize:12, fontWeight:700, color:"#fff" }}>{vibe.msg}{bonus}</div>
        <div style={{ fontSize:10, color:"#94a3b8", marginTop:1 }}>{day} · Eyes on the stock levels. Your boss certainly isn't.</div>
      </div>
    </div>
  );
}

const FIELDS = [
  { key: "name", label: "Item Name" },
  { key: "category", label: "Category", type: "select", options: ["Forms", "Digital", "Supplies", "Equipment"] },
  { key: "qty", label: "Quantity", type: "number" },
  { key: "unit", label: "Unit", placeholder: "pcs, reams..." },
  { key: "reorder", label: "Reorder Point", type: "number" },
  { key: "cost", label: "Unit Cost (AED)", type: "number" },
  { key: "supplier", label: "Supplier ID", placeholder: "S001..." },
  { key: "status", label: "Status", type: "select", options: ["In Stock", "Low Stock", "Critical"] },
];

// ─── Rich Add Item Modal ──────────────────────────────────────────────────────

const CATEGORY_CONFIG = {
  "Forms":     { emoji: "📋", color: "#3b82f6", bg: "#eff6ff", border: "#bfdbfe" },
  "Digital":   { emoji: "💾", color: "#8b5cf6", bg: "#f5f3ff", border: "#ddd6fe" },
  "Supplies":  { emoji: "🖊️",  color: "#10b981", bg: "#ecfdf5", border: "#a7f3d0" },
  "Equipment": { emoji: "🔧", color: "#f59e0b", bg: "#fffbeb", border: "#fde68a" },
};

const STATUS_CONFIG = {
  "In Stock":  { emoji: "✅", color: "#10b981", bg: "#ecfdf5", border: "#6ee7b7" },
  "Low Stock": { emoji: "⚠️", color: "#f59e0b", bg: "#fffbeb", border: "#fcd34d" },
  "Critical":  { emoji: "🚨", color: "#ef4444", bg: "#fef2f2", border: "#fca5a5" },
};

const UNIT_PRESETS = ["pcs", "reams", "boxes", "sets", "units", "packs", "rolls", "sheets", "kg", "liters"];

function AddItemModal({ onSave, onClose }) {
  const [step, setStep] = useState(1);
  const [vals, setVals] = useState({
    name: "", category: "Supplies", qty: 1, unit: "pcs",
    reorder: 5, cost: 0, supplier: "", status: "In Stock",
    location: "", sku: "", notes: "", tags: "",
  });
  const [errors, setErrors] = useState({});

  const set = (k, v) => setVals(p => ({ ...p, [k]: v }));
  const err = (k) => errors[k] ? { border: "1.5px solid #ef4444" } : {};

  const validateStep1 = () => {
    const e = {};
    if (!vals.name.trim()) e.name = true;
    setErrors(e);
    return !Object.keys(e).length;
  };

  const handleNext = () => {
    if (step === 1 && !validateStep1()) return;
    setStep(s => s + 1);
  };

  const handleSubmit = () => {
    onSave({
      name: vals.name.trim(),
      category: vals.category,
      qty: Number(vals.qty) || 0,
      unit: vals.unit,
      reorder: Number(vals.reorder) || 0,
      cost: Number(vals.cost) || 0,
      supplier: vals.supplier.trim(),
      status: vals.status,
      location: vals.location.trim(),
      sku: vals.sku.trim(),
      notes: vals.notes.trim(),
      tags: vals.tags.trim(),
    });
    onClose();
  };

  const inputStyle = (extra = {}) => ({
    width: "100%", padding: "9px 12px", borderRadius: 8, fontSize: 13,
    border: `1.5px solid ${B.border}`, background: B.white, color: B.text,
    outline: "none", boxSizing: "border-box", ...extra,
  });

  const labelStyle = { fontSize: 10, fontWeight: 700, color: B.muted, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 5, display: "block" };

  const STEPS = ["Basics", "Stock", "Details"];

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)", zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center",
      backdropFilter: "blur(4px)",
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: B.white,
        border: `1px solid ${B.border}`, borderRadius: 16, width: 520, maxWidth: "95vw",
        boxShadow: "0 32px 80px rgba(0,0,0,0.15)", overflow: "hidden",
        animation: "modalIn 0.25s cubic-bezier(0.34,1.4,0.64,1)",
      }}>
        <style>{`
          @keyframes modalIn { from { opacity:0; transform:scale(0.94) translateY(12px); } to { opacity:1; transform:scale(1) translateY(0); } }
          .add-input:focus { border-color:${B.blue} !important; box-shadow:0 0 0 3px rgba(59,130,246,0.12); }
          .pill-btn { cursor:pointer; transition:all 0.15s; }
          .pill-btn:hover { transform:translateY(-1px); }
        `}</style>

        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: `1px solid ${B.border}`, background: B.light }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: B.text, letterSpacing: -0.3 }}>
                📦 New Inventory Item
              </div>
              <div style={{ fontSize: 11, color: B.muted, marginTop: 2 }}>
                Fill in the details below — required fields on step 1
              </div>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", color: B.muted, fontSize: 20, cursor: "pointer", padding: "0 4px", lineHeight: 1 }}>✕</button>
          </div>

          {/* Step indicator */}
          <div style={{ display: "flex", gap: 6, marginTop: 16 }}>
            {STEPS.map((s, i) => (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                <div style={{
                  width: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 800,
                  background: step > i + 1 ? B.green : step === i + 1 ? B.blue : B.border,
                  color: step >= i + 1 ? "#fff" : B.muted,
                  border: `2px solid ${step > i + 1 ? B.green : step === i + 1 ? B.blue : B.border}`,
                  transition: "all 0.2s",
                }}>
                  {step > i + 1 ? "✓" : i + 1}
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, color: step === i + 1 ? B.text : B.muted }}>{s}</span>
                {i < STEPS.length - 1 && <div style={{ flex: 1, height: 1, background: step > i + 1 ? B.green : B.border, marginLeft: 2 }} />}
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 24px" }}>

          {/* ── STEP 1: Basics ── */}
          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={labelStyle}>Item Name *</label>
                <input className="add-input" value={vals.name} onChange={e => set("name", e.target.value)}
                  placeholder="e.g. A4 Copy Paper, Stapler Pro 3000…"
                  style={{ ...inputStyle(err("name")), ...(errors.name ? { borderColor: B.red } : {}) }}
                  autoFocus
                />
                {errors.name && <div style={{ fontSize: 10, color: B.red, marginTop: 3 }}>Item name is required</div>}
              </div>

              <div>
                <label style={labelStyle}>Category</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {Object.entries(CATEGORY_CONFIG).map(([cat, cfg]) => (
                    <button key={cat} className="pill-btn" onClick={() => set("category", cat)} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
                      borderRadius: 10, cursor: "pointer", textAlign: "left",
                      background: vals.category === cat ? `${cfg.color}12` : B.white,
                      border: `2px solid ${vals.category === cat ? cfg.color : B.border}`,
                      color: vals.category === cat ? cfg.color : B.muted,
                      fontWeight: 700, fontSize: 13,
                    }}>
                      <span style={{ fontSize: 20 }}>{cfg.emoji}</span>
                      <span>{cat}</span>
                      {vals.category === cat && <span style={{ marginLeft: "auto", fontSize: 14 }}>✓</span>}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={labelStyle}>Status</label>
                <div style={{ display: "flex", gap: 8 }}>
                  {Object.entries(STATUS_CONFIG).map(([st, cfg]) => (
                    <button key={st} className="pill-btn" onClick={() => set("status", st)} style={{
                      flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                      padding: "10px 8px", borderRadius: 10, cursor: "pointer",
                      background: vals.status === st ? `${cfg.color}12` : B.white,
                      border: `2px solid ${vals.status === st ? cfg.color : B.border}`,
                      color: vals.status === st ? cfg.color : B.muted,
                      fontWeight: 700, fontSize: 11,
                    }}>
                      <span style={{ fontSize: 18 }}>{cfg.emoji}</span>
                      <span>{st}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 2: Stock ── */}
          {step === 2 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <label style={labelStyle}>Quantity — {vals.qty} {vals.unit}</label>
                <input type="range" min={0} max={500} value={vals.qty}
                  onChange={e => set("qty", Number(e.target.value))}
                  style={{ width: "100%", accentColor: B.blue, cursor: "pointer" }}
                />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: B.muted, marginTop: 2 }}>
                  <span>0</span><span style={{ fontWeight: 700, color: B.blue }}>{vals.qty}</span><span>500+</span>
                </div>
                <input className="add-input" type="number" value={vals.qty} onChange={e => set("qty", e.target.value)}
                  placeholder="Exact qty" style={{ ...inputStyle(), marginTop: 8, width: 120 }} />
              </div>

              <div>
                <label style={labelStyle}>Unit</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                  {UNIT_PRESETS.map(u => (
                    <button key={u} className="pill-btn" onClick={() => set("unit", u)} style={{
                      padding: "5px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: "pointer",
                      background: vals.unit === u ? B.blue : B.light,
                      color: vals.unit === u ? "#fff" : B.muted,
                      border: `1.5px solid ${vals.unit === u ? B.blue : B.border}`,
                    }}>{u}</button>
                  ))}
                </div>
                <input className="add-input" value={vals.unit} onChange={e => set("unit", e.target.value)}
                  placeholder="Custom unit…" style={inputStyle()} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelStyle}>Reorder Point</label>
                  <input className="add-input" type="number" value={vals.reorder} onChange={e => set("reorder", e.target.value)}
                    placeholder="Min before reorder" style={inputStyle()} />
                  <div style={{ fontSize: 10, color: B.muted, marginTop: 3 }}>Alert when qty drops below this</div>
                </div>
                <div>
                  <label style={labelStyle}>Unit Cost (AED)</label>
                  <input className="add-input" type="number" value={vals.cost} onChange={e => set("cost", e.target.value)}
                    placeholder="0.00" style={inputStyle()} />
                  {vals.cost > 0 && vals.qty > 0 && (
                    <div style={{ fontSize: 10, color: B.green, marginTop: 3 }}>
                      Total value: AED {(Number(vals.cost) * Number(vals.qty)).toLocaleString("en", { minimumFractionDigits: 2 })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── STEP 3: Details ── */}
          {step === 3 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={labelStyle}>Supplier ID</label>
                  <input className="add-input" value={vals.supplier} onChange={e => set("supplier", e.target.value)}
                    placeholder="S001, ACME Ltd…" style={inputStyle()} />
                </div>
                <div>
                  <label style={labelStyle}>SKU / Ref Code</label>
                  <input className="add-input" value={vals.sku} onChange={e => set("sku", e.target.value)}
                    placeholder="SKU-001…" style={inputStyle()} />
                </div>
              </div>
              <div>
                <label style={labelStyle}>Storage Location</label>
                <input className="add-input" value={vals.location} onChange={e => set("location", e.target.value)}
                  placeholder="Shelf A3, Cabinet 2, Warehouse B…" style={inputStyle()} />
              </div>
              <div>
                <label style={labelStyle}>Tags</label>
                <input className="add-input" value={vals.tags} onChange={e => set("tags", e.target.value)}
                  placeholder="urgent, seasonal, high-value… (comma separated)" style={inputStyle()} />
              </div>
              <div>
                <label style={labelStyle}>Notes</label>
                <textarea className="add-input" value={vals.notes} onChange={e => set("notes", e.target.value)}
                  placeholder="Fragile, bulk order needed, preferred supplier contact…"
                  rows={3} style={{ ...inputStyle(), resize: "vertical", fontFamily: "inherit" }} />
              </div>

              {/* Summary card */}
              <div style={{
                background: B.light, border: `1px solid ${B.border}`, borderRadius: 10, padding: "12px 16px",
                display: "flex", gap: 12, alignItems: "center",
              }}>
                <span style={{ fontSize: 28 }}>{CATEGORY_CONFIG[vals.category]?.emoji}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: B.text }}>{vals.name || "Unnamed Item"}</div>
                  <div style={{ fontSize: 11, color: B.muted, marginTop: 2 }}>
                    {vals.qty} {vals.unit} · {vals.category} · {vals.status}
                    {vals.cost > 0 && ` · AED ${Number(vals.cost).toLocaleString()} /unit`}
                  </div>
                </div>
                <div style={{
                  padding: "4px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700,
                  background: `${STATUS_CONFIG[vals.status]?.color}15`,
                  color: STATUS_CONFIG[vals.status]?.color,
                  border: `1.5px solid ${STATUS_CONFIG[vals.status]?.color}50`,
                }}>
                  {STATUS_CONFIG[vals.status]?.emoji} {vals.status}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "14px 24px 20px", borderTop: `1px solid ${B.border}`, background: B.light,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <button onClick={step === 1 ? onClose : () => setStep(s => s - 1)} style={{
            padding: "8px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
            background: B.white, color: B.muted, border: `1.5px solid ${B.border}`,
          }}>
            {step === 1 ? "Cancel" : "← Back"}
          </button>
          <div style={{ display: "flex", gap: 6 }}>
            {[1,2,3].map(i => <div key={i} style={{ width: i === step ? 18 : 6, height: 6, borderRadius: 3, background: i === step ? B.blue : B.border, transition: "all 0.2s" }} />)}
          </div>
          {step < 3
            ? <button onClick={handleNext} style={{
                padding: "8px 22px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
                background: "linear-gradient(135deg,#3b82f6,#2563eb)", color: "#fff", border: "none",
                boxShadow: "0 4px 14px rgba(59,130,246,0.35)",
              }}>
                Next →
              </button>
            : <button onClick={handleSubmit} style={{
                padding: "8px 22px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer",
                background: "linear-gradient(135deg,#10b981,#059669)", color: "#fff", border: "none",
                boxShadow: "0 4px 14px rgba(16,185,129,0.35)",
              }}>
                ✓ Add Item
              </button>
          }
        </div>
      </div>
    </div>
  );
}

const InventoryTab = ({ data, setData, viewMode, search }) => {
  const [modal, setModal] = useState(false);
  const [editModal, setEditModal] = useState(null);
  const { xp, gain } = useXP("inv_xp");
  const { toasts, push } = useToasts();
  const [newlyUnlocked, setNewlyUnlocked] = useState([]);
  const unlockedRef = useRef(new Set(JSON.parse(localStorage.getItem("inv_achievements") || "[]")));

  const inventory = data.inventory || [];
  const tasks     = data.tasks     || [];

  // Multi-user sync integration
  const currentUser = { userId: "user_1", userName: "Current User", userRole: "Admin" };
  const { activeUsers, tabLocks, requestLock, releaseLock, broadcastUpdate, broadcastTabChange } = useMultiUserSync(currentUser.userId, currentUser.userName, currentUser.userRole);

  // Workflow integration
  const inventoryWorkflow = workflowEngine.getWorkflowByEntityType("inventory");
  const [slaAlerts, setSlaAlerts] = useState([]);
  const [workflowHistory, setWorkflowHistory] = useState([]);

  // Check SLA alerts
  useEffect(() => {
    if (inventoryWorkflow) {
      const alerts = workflowEngine.getSLAAlerts(inventoryWorkflow.id, data.inventory);
      setSlaAlerts(alerts);
    }
  }, [data.inventory, inventoryWorkflow]);

  // Broadcast tab change
  useEffect(() => {
    broadcastTabChange("inventory");
  }, [broadcastTabChange]);

  // Mobile responsiveness
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const isPhone = windowWidth < 640;
  const isTablet = windowWidth >= 640 && windowWidth < 1100;
  const isDesktop = windowWidth >= 1100;

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // 15+ additional features for InventoryTab
  const [showStockAlerts, setShowStockAlerts] = useState(false);
  const [showSupplierManagement, setShowSupplierManagement] = useState(false);
  const [showReorderAutomation, setShowReorderAutomation] = useState(false);
  const [showInventoryForecast, setShowInventoryForecast] = useState(false);
  const [showWarehouseMap, setShowWarehouseMap] = useState(false);
  const [showBarcodeScanning, setShowBarcodeScanning] = useState(false);
  const [showBatchManagement, setShowBatchManagement] = useState(false);
  const [showExpirationTracking, setShowExpirationTracking] = useState(false);
  const [showInventoryReports, setShowInventoryReports] = useState(false);
  const [showStockTransfers, setShowStockTransfers] = useState(false);
  const [showInventoryAudit, setShowInventoryAudit] = useState(false);
  const [showMultiLocation, setShowMultiLocation] = useState(false);
  const [showInventoryValuation, setShowInventoryValuation] = useState(false);
  const [showStockMovement, setShowStockMovement] = useState(false);
  const [showInventoryAnalytics, setShowInventoryAnalytics] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const freshUnlocks = [];
    INV_ACHIEVEMENTS.forEach(a => {
      if (!unlockedRef.current.has(a.id) && a.check(inventory, tasks)) {
        unlockedRef.current.add(a.id);
        freshUnlocks.push(a.id);
        gain(50);
        push(`${a.title} — ${a.desc}`, a.icon, "achievement", "Achievement Unlocked!");
      }
    });
    if (freshUnlocks.length) {
      localStorage.setItem("inv_achievements", JSON.stringify([...unlockedRef.current]));
      setNewlyUnlocked(prev => [...prev, ...freshUnlocks]);
      setTimeout(() => setNewlyUnlocked(prev => prev.filter(id => !freshUnlocks.includes(id))), 4000);
    }
  }, [inventory, tasks]);

  const [localSearch, setLocalSearch] = useState(search || "");
  const parsedQuery = useMemo(() => parseOperatorQuery(localSearch || search || ""), [localSearch, search]);
  const INV_SUGGESTION_FIELDS = ["status", "category", "supplier", "name"];
  const { suggestions: invSuggestions, showSuggestions: invShowSuggestions, onSuggestionSelect: invOnSuggestionSelect } = useSearchSuggestions(localSearch, INV_SUGGESTION_FIELDS, setLocalSearch);

  let rows = useTableFilterV2(data.inventory, parsedQuery, ["id", "name", "category", "supplier", "status"]);
  const { sortedData: invSortedRows, sortKey: invSortKey, sortDir: invSortDir, toggleSort: invToggleSort } = useSortedData(rows);
  rows = invSortedRows;
  const { page: invPage, setPage: setInvPage, pageSize: invPageSize, setPageSize: setInvPageSize, pageData: invPageData, pageCount: invPageCount } = usePagination(rows);

  const handleReorder = (item, evt) => {
    const title = `Reorder: ${item.name} (min qty: ${item.reorder}) from ${item.supplier || "supplier"}`;
    const alreadyExists = (data.tasks || []).some(t => t.ref === item.id && t.title.startsWith("Reorder:"));
    if (alreadyExists) { alert("Reorder task already exists for this item."); return; }
    setData({ ...data, tasks: [...(data.tasks || []), { id: nextId("T"), title, assigned: "", priority: item.status === "Critical" ? "High" : "Medium", status: "Pending", due: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0,10), ref: item.id }] });
    gain(10);
    push(REORDER_TOASTS[Math.floor(Math.random() * REORDER_TOASTS.length)], "↺", "reorder");
    if (evt) spawnConfetti(evt.clientX, evt.clientY);
  };

  const cols = [
    { key: "id", label: "ID", width: 70 },
    { key: "name", label: "Item Name", width: 200 },
    { key: "category", label: "Category", width: 120 },
    { key: "qty", label: "Qty", width: 80 },
    { key: "unit", label: "Unit", width: 80 },
    { key: "reorder", label: "Reorder Pt.", width: 100 },
    { key: "cost", label: "Unit Cost", width: 100, render: (v) => aed(v), xlRender: (v) => aed(v) },
    { key: "supplier", label: "Supplier", width: 90 },
    { key: "status", label: "Status", width: 110, render: (v) => <Badge label={v} /> },
    {
      key: "reorderBtn", label: "Action", width: 160,
      render: (_, r) => (
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => setEditModal(r)} style={{ padding: "3px 8px", fontSize: 10, fontWeight: 700, background: B.blue + "12", color: B.blue, border: `1px solid ${B.blue}30`, borderRadius: 4, cursor: "pointer" }}>
            ✏ Edit
          </button>
          {r.status !== "In Stock" ? (
            <button onClick={(e) => handleReorder(r, e)} style={{ padding: "3px 9px", fontSize: 10, fontWeight: 700, background: B.orange + "18", color: B.orange, border: `1px solid ${B.orange}40`, borderRadius: 4, cursor: "pointer" }}>
              ↺ Reorder
            </button>
          ) : <span style={{ fontSize: 11, color: B.muted }}>—</span>}
        </div>
      ),
    },
  ];

  const handleChange = (ri, key, val) => {
    const updated = [...data.inventory];
    updated[ri] = { ...updated[ri], [key]: val };
    setData({ ...data, inventory: updated });
  };

  const handleDelete = (ri) => {
    const updated = [...data.inventory];
    updated.splice(ri, 1);
    setData({ ...data, inventory: updated });
  };

  const handleAdd = (vals) => {
    setData({ ...data, inventory: [...data.inventory, { id: nextId("I"), ...vals, qty: Number(vals.qty) || 0, reorder: Number(vals.reorder) || 0, cost: Number(vals.cost) || 0 }] });
    gain(5);
    push(ADD_TOASTS[Math.floor(Math.random() * ADD_TOASTS.length)], "📦", "add");
  };

  const handleEdit = (vals) => {
    const updated = data.inventory.map(item =>
      item.id === editModal.id
        ? { ...item, ...vals, qty: Number(vals.qty) || 0, reorder: Number(vals.reorder) || 0, cost: Number(vals.cost) || 0 }
        : item
    );
    setData({ ...data, inventory: updated });
    setEditModal(null);
    gain(5);
    push(EDIT_TOASTS[Math.floor(Math.random() * EDIT_TOASTS.length)], "✏️", "edit");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <DailyVibeBar />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <XPBar xp={xp} />
        <AchievementShelf inventory={inventory} tasks={tasks} newlyUnlocked={newlyUnlocked} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={() => setModal(true)} style={{
          padding: "8px 18px", background: "linear-gradient(135deg,#3b82f6,#2563eb)", color: "#fff",
          border: "none", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer",
          boxShadow: "0 4px 14px rgba(59,130,246,0.3)", letterSpacing: 0.2,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <span style={{ fontSize: 15 }}>＋</span> Add Item
        </button>
      </div>
      {/* Search + suggestions */}
      <div style={{ position:"relative" }}>
        <input
          value={localSearch}
          onChange={e => setLocalSearch(e.target.value)}
          placeholder="Search inventory… (e.g. status:Critical category:Tools)"
          style={{ width:"100%", padding:"7px 12px", fontSize:12, border:`1px solid ${B.border}`, borderRadius:6, outline:"none", boxSizing:"border-box" }}
        />
        {invShowSuggestions && invSuggestions.length > 0 && (
          <div style={{ position:"absolute", top:"100%", left:0, right:0, zIndex:400, background:"#fff", border:`1px solid ${B.border}`, borderRadius:6, boxShadow:"0 4px 16px rgba(0,0,0,0.10)", maxHeight:200, overflowY:"auto" }}>
            {invSuggestions.map((s, i) => (
              <div key={i} onClick={() => invOnSuggestionSelect(s)} style={{ padding:"7px 12px", fontSize:12, cursor:"pointer", borderBottom:`1px solid ${B.border}` }}
                onMouseEnter={e=>e.currentTarget.style.background=B.light}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                {s}
              </div>
            ))}
          </div>
        )}
      </div>
      <SectionCard title={`Inventory — ${rows.length} items`}>
        {viewMode === "excel"
          ? <><div className="excel-mobile-warning"><span style={{fontSize:24}}>🖥️</span><span>Excel view is only available on desktop</span></div><div className="excel-table-wrap" style={{ maxHeight: "calc(100vh - 280px)", display: "flex", flexDirection: "column", overflow: "hidden" }}><ExcelTable cols={cols} rows={invPageData} onChange={handleChange} onDelete={handleDelete} /></div></>
          : (
            <>
              <NTable cols={cols} rows={invPageData} />
              {invPageCount > 1 && (
                <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 0", fontSize:12, color:B.muted }}>
                  <button onClick={() => setInvPage(p => Math.max(0,p-1))} disabled={invPage===0} style={{ padding:"3px 10px", border:`1px solid ${B.border}`, borderRadius:5, cursor:"pointer", background:"#fff" }}>‹</button>
                  <span>Page {invPage+1} / {invPageCount}</span>
                  <button onClick={() => setInvPage(p => Math.min(invPageCount-1,p+1))} disabled={invPage===invPageCount-1} style={{ padding:"3px 10px", border:`1px solid ${B.border}`, borderRadius:5, cursor:"pointer", background:"#fff" }}>›</button>
                  <select value={invPageSize} onChange={e=>{ setInvPageSize(Number(e.target.value)); setInvPage(0); }} style={{ marginLeft:"auto", padding:"3px 6px", fontSize:11, border:`1px solid ${B.border}`, borderRadius:5 }}>
                    {[10,25,50,100].map(n=><option key={n} value={n}>{n} / page</option>)}
                  </select>
                </div>
              )}
            </>
          )}
      </SectionCard>
      {modal && <AddItemModal onSave={handleAdd} onClose={() => setModal(false)} />}
      {editModal && (
        <FormModal
          title={`Edit Item — ${editModal.name}`}
          fields={FIELDS}
          initialValues={editModal}
          onSave={handleEdit}
          onClose={() => setEditModal(null)}
        />
      )}
      <ToastStack toasts={toasts} />
    </div>
  );
};

export default InventoryTab;
