import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { aed, filterSearch, nextId, parseOperatorQuery } from "../helpers";
import { useTableFilterV2, useSortedData, usePagination, useSearchSuggestions } from "../hooks";
import { B } from "../constants";
import Badge from "../components/Badge";
import SectionCard from "../components/SectionCard";
import NTable from "../components/NTable";
import ExcelTable from "../components/ExcelTable";
import FormModal from "../components/FormModal";

// ─── Fun Layer: Suppliers Edition ────────────────────────────────────────────

const SUP_VIBES = [
  { hour: [6,11],  emoji: "🤝", msg: "Morning vendor check-in. Who owes who? Let's find out." },
  { hour: [11,14], emoji: "📞", msg: "Midday supplier hustle. Negotiate like you mean it." },
  { hour: [14,17], emoji: "💼", msg: "Afternoon procurement session. You're basically a CFO." },
  { hour: [17,20], emoji: "🌆", msg: "Golden hour — settle those balances before EOD." },
  { hour: [20,24], emoji: "🌙", msg: "Night supplier audit. The dedication is noted. Barely." },
  { hour: [0,6],   emoji: "🦉", msg: "3am supplier management. We're not asking questions." },
];

const ADD_TOASTS = [
  "🤝 New supplier onboarded. The vendor network grows.",
  "📋 Supplier registered. You just expanded your empire.",
  "✅ Added to the roster. Welcome to the supply chain.",
  "🏷️ Vendor catalogued. Very professional of you.",
  "📦 Supplier locked in. The procurement gods approve.",
  "🚀 New contact added. Your Rolodex just got better.",
  "💼 Onboarded. Someone's building a proper vendor list.",
  "📬 Supplier added. One step closer to supply chain dominance.",
  "⚡ New vendor registered. You run a tight operation.",
  "🎯 Added. Your boss will never know how hard you work.",
];

const PAY_TOASTS = [
  "💳 Payment processed. The supplier breathes easy.",
  "💸 Balance settled. Clean books, clean conscience.",
  "🤑 Paid! Your vendor relationship just levelled up.",
  "🏆 Balance cleared. Absolute financial discipline.",
  "✅ Payment confirmed. This is what responsibility looks like.",
  "💰 Settled. You're the kind of client suppliers dream of.",
  "🎯 Payment sent. On time, on point, on budget.",
  "🧾 Cleared! Zero balance. Beautiful.",
  "⚡ Payment done. The invoice gods smile upon you.",
  "😎 Paid. Effortlessly. As expected.",
];

const EDIT_TOASTS = [
  "✏️ Supplier updated. Accuracy above all.",
  "🔧 Record tweaked. Clean data, clean operation.",
  "📝 Changes saved. The audit trail thanks you.",
  "⚙️ Updated. Meticulous as always.",
  "🔄 Edit locked in. Supplier data stays fresh.",
];

const SUP_ACHIEVEMENTS = [
  { id: "sup_first",      icon: "🤝", title: "First Vendor",      desc: "Added your first supplier",                              check: (sup) => sup.length >= 1 },
  { id: "sup_five",       icon: "📋", title: "Vendor Network",    desc: "5+ suppliers on the books",                              check: (sup) => sup.length >= 5 },
  { id: "sup_payment",    icon: "💳", title: "Square Deal",       desc: "Made your first balance payment",                        check: (sup) => sup.some(s => (s._paid || 0) > 0 || s.balance === 0 && s._hadBalance) },
  { id: "sup_zero_bal",   icon: "✨", title: "Clean Ledger",      desc: "All active suppliers at zero balance",                   check: (sup) => sup.filter(s => s.status === "Active").length > 0 && sup.filter(s => s.status === "Active").every(s => (s.balance || 0) === 0) },
  { id: "sup_categories", icon: "🏷️", title: "Diverse Portfolio", desc: "Suppliers across 4+ categories",                        check: (sup) => new Set(sup.map(s => s.category)).size >= 4 },
  { id: "sup_ten",        icon: "🏭", title: "Supply Chain Boss", desc: "10+ suppliers managed",                                  check: (sup) => sup.length >= 10 },
  { id: "sup_all_active", icon: "💚", title: "100% Active",       desc: "All suppliers are active — none inactive",              check: (sup) => sup.length > 0 && sup.every(s => s.status === "Active") },
  { id: "sup_high_roller", icon: "💎", title: "High Roller",      desc: "Single supplier balance over AED 50,000",               check: (sup) => sup.some(s => (s.balance || 0) >= 50000) },
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
  const push = useCallback((msg, icon = "🤝", type = "add", title = null) => {
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

function useXP(storageKey = "sup_xp") {
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
        <div style={{ fontSize:18, lineHeight:1 }}>🤝</div>
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

function AchievementShelf({ suppliers, newlyUnlocked }) {
  const unlocked = SUP_ACHIEVEMENTS.filter(a => a.check(suppliers));
  return (
    <div style={{ background:B.white, border:`1px solid ${B.border}`, borderRadius:10, padding:"10px 14px" }}>
      <div style={{ fontSize:10, fontWeight:700, color:B.muted, textTransform:"uppercase", letterSpacing:0.5, marginBottom:8 }}>🏆 Achievements</div>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        {SUP_ACHIEVEMENTS.map(a => {
          const done  = a.check(suppliers);
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
      <div style={{ fontSize:9, color:B.muted, marginTop:6 }}>{unlocked.length}/{SUP_ACHIEVEMENTS.length} unlocked — hover for details</div>
    </div>
  );
}

function DailyVibeBar() {
  const h    = new Date().getHours();
  const vibe = SUP_VIBES.find(v => h >= v.hour[0] && h < v.hour[1]) || SUP_VIBES[0];
  const day  = new Date().toLocaleDateString("en", { weekday:"long" });
  const isMonday = new Date().getDay() === 1;
  const isFriday = new Date().getDay() === 5;
  const bonus = isMonday ? " Monday vendor review? Bold. Respect." : isFriday ? " Friday! Settle balances so the weekend is guilt-free." : "";
  return (
    <div style={{ background:`linear-gradient(135deg,#0f172a,#1e293b)`, borderRadius:10, padding:"10px 16px", display:"flex", alignItems:"center", gap:12 }}>
      <span style={{ fontSize:22 }}>{vibe.emoji}</span>
      <div>
        <div style={{ fontSize:12, fontWeight:700, color:"#fff" }}>{vibe.msg}{bonus}</div>
        <div style={{ fontSize:10, color:"#94a3b8", marginTop:1 }}>{day} · Keep those supplier relationships warm. Your boss can't even name three of them.</div>
      </div>
    </div>
  );
}

const FIELDS = [
  { key: "name", label: "Supplier Name" },
  { key: "contact", label: "Contact Person" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone" },
  { key: "category", label: "Category", type: "select", options: ["Government Forms", "Digital Products", "Office Supplies", "Courier", "Other"] },
  { key: "status", label: "Status", type: "select", options: ["Active", "Inactive"] },
  { key: "terms", label: "Payment Terms", placeholder: "Net 30, COD..." },
  { key: "balance", label: "Balance (AED)", type: "number", default: "0" },
];

const SuppliersTab = ({ data, setData, viewMode, search }) => {
  const [modal, setModal] = useState(false);
  const [editModal, setEditModal] = useState(null); // supplier to edit
  const [payModal, setPayModal] = useState(null); // supplier row index
  const [linkedModal, setLinkedModal] = useState(null); // supplier id

  // ── Fun layer ──────────────────────────────────────────────────────────────
  const { toasts, push }         = useToasts();
  const { xp, gain }             = useXP();
  const [newlyUnlocked, setNewlyUnlocked] = useState([]);
  const prevUnlockedRef = useRef(null);

  // Check achievements after every supplier list change
  const checkAchievements = useCallback((suppliers) => {
    const prevIds = prevUnlockedRef.current;
    if (prevIds === null) {
      // First render — seed silently so we don't spam on mount
      prevUnlockedRef.current = new Set(SUP_ACHIEVEMENTS.filter(a => a.check(suppliers)).map(a => a.id));
      return;
    }
    const freshIds = new Set(SUP_ACHIEVEMENTS.filter(a => a.check(suppliers)).map(a => a.id));
    const brandNew = [...freshIds].filter(id => !prevIds.has(id));
    if (brandNew.length) {
      brandNew.forEach(id => {
        const ach = SUP_ACHIEVEMENTS.find(a => a.id === id);
        push(`${ach.title} — ${ach.desc}`, ach.icon, "achievement", "Achievement Unlocked");
        gain(25);
        spawnConfetti(window.innerWidth / 2, window.innerHeight / 2);
      });
      setNewlyUnlocked(prev => [...prev, ...brandNew]);
      setTimeout(() => setNewlyUnlocked(prev => prev.filter(id => !brandNew.includes(id))), 3000);
    }
    prevUnlockedRef.current = freshIds;
  }, [push, gain]);

  useEffect(() => {
    checkAchievements(data.suppliers);
  }, [data.suppliers]); // eslint-disable-line react-hooks/exhaustive-deps
  // ──────────────────────────────────────────────────────────────────────────

  const [localSearch, setLocalSearch] = useState(search || "");
  const parsedQuery = useMemo(() => parseOperatorQuery(localSearch || search || ""), [localSearch, search]);
  const SUP_SUGGESTION_FIELDS = ["status", "category", "name", "contact"];
  const { suggestions: supSuggestions, showSuggestions: supShowSuggestions, onSuggestionSelect: supOnSuggestionSelect } = useSearchSuggestions(localSearch, SUP_SUGGESTION_FIELDS, setLocalSearch);

  let rows = useTableFilterV2(data.suppliers, parsedQuery, ["id", "name", "contact", "email", "category", "status"]);
  const { sortedData: supSortedRows, sortKey: supSortKey, sortDir: supSortDir, toggleSort: supToggleSort } = useSortedData(rows);
  rows = supSortedRows;
  const { page: supPage, setPage: setSupPage, pageSize: supPageSize, setPageSize: setSupPageSize, pageData: supPageData, pageCount: supPageCount } = usePagination(rows);

  const handlePayBalance = (ri, amount) => {
    const updated = [...data.suppliers];
    const paid = Math.min(Number(amount) || 0, updated[ri].balance);
    const hadBalance = updated[ri].balance > 0;
    updated[ri] = { ...updated[ri], balance: updated[ri].balance - paid, _paid: (updated[ri]._paid || 0) + paid, _hadBalance: hadBalance };
    setData({ ...data, suppliers: updated });
    setPayModal(null);
    if (paid > 0) {
      const msg = PAY_TOASTS[Math.floor(Math.random() * PAY_TOASTS.length)];
      push(msg.slice(2).trim(), msg.slice(0, 2).trim(), "pay");
      gain(15);
    }
  };

  const cols = [
    { key: "id", label: "ID", width: 70 },
    { key: "name", label: "Supplier", width: 200 },
    { key: "contact", label: "Contact", width: 140 },
    { key: "category", label: "Category", width: 140 },
    { key: "status", label: "Status", width: 100, render: (v) => <Badge label={v} /> },
    { key: "terms", label: "Terms", width: 90 },
    { key: "balance", label: "Balance", width: 110, render: (v) => aed(v), xlRender: (v) => aed(v) },
    { key: "email", label: "Email", width: 180 },
    { key: "phone", label: "Phone", width: 150 },
    {
      key: "_actions", label: "Actions", width: 200,
      render: (_, r, ri) => (
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => setEditModal(r)}
            style={{ padding: "3px 8px", fontSize: 10, fontWeight: 700, background: B.blue + "12", color: B.blue, border: `1px solid ${B.blue}30`, borderRadius: 4, cursor: "pointer" }}>
            ✏ Edit
          </button>
          {r.balance > 0 && (
            <button onClick={(e) => { spawnConfetti(e.clientX, e.clientY); setPayModal(ri); }}
              style={{ padding: "3px 8px", fontSize: 10, fontWeight: 700, background: B.green + "15", color: B.green, border: `1px solid ${B.green}40`, borderRadius: 4, cursor: "pointer" }}>
              💳 Pay
            </button>
          )}
          <button onClick={() => setLinkedModal(r.id)}
            style={{ padding: "3px 8px", fontSize: 10, fontWeight: 700, background: B.blue + "12", color: B.blue, border: `1px solid ${B.blue}30`, borderRadius: 4, cursor: "pointer" }}>
            📦 Items
          </button>
        </div>
      ),
    },
  ];

  const handleChange = (ri, key, val) => {
    const updated = [...data.suppliers];
    updated[ri] = { ...updated[ri], [key]: val };
    setData({ ...data, suppliers: updated });
  };

  const handleDelete = (ri) => {
    const updated = [...data.suppliers];
    updated.splice(ri, 1);
    setData({ ...data, suppliers: updated });
  };

  const handleAdd = (vals) => {
    setData({ ...data, suppliers: [...data.suppliers, { id: nextId("S"), ...vals, balance: Number(vals.balance) || 0 }] });
    const msg = ADD_TOASTS[Math.floor(Math.random() * ADD_TOASTS.length)];
    push(msg.slice(2).trim(), msg.slice(0, 2).trim(), "add");
    gain(20);
  };

  const handleEdit = (vals) => {
    const updated = data.suppliers.map(s =>
      s.id === editModal.id
        ? { ...s, ...vals, balance: Number(vals.balance) || 0 }
        : s
    );
    setData({ ...data, suppliers: updated });
    setEditModal(null);
    const msg = EDIT_TOASTS[Math.floor(Math.random() * EDIT_TOASTS.length)];
    push(msg.slice(2).trim(), msg.slice(0, 2).trim(), "edit");
    gain(5);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* ── Fun layer UI ── */}
      <DailyVibeBar />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <XPBar xp={xp} />
        <AchievementShelf suppliers={data.suppliers} newlyUnlocked={newlyUnlocked} />
      </div>
      {/* ── Controls ── */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={() => setModal(true)} style={{ padding: "6px 14px", background: B.blue, color: "#fff", border: "none", borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>+ Add Supplier</button>
      </div>
      {/* Search + suggestions */}
      <div style={{ position:"relative" }}>
        <input
          value={localSearch}
          onChange={e => setLocalSearch(e.target.value)}
          placeholder="Search suppliers… (e.g. status:Active category:Logistics)"
          style={{ width:"100%", padding:"7px 12px", fontSize:12, border:`1px solid ${B.border}`, borderRadius:6, outline:"none", boxSizing:"border-box" }}
        />
        {supShowSuggestions && supSuggestions.length > 0 && (
          <div style={{ position:"absolute", top:"100%", left:0, right:0, zIndex:400, background:"#fff", border:`1px solid ${B.border}`, borderRadius:6, boxShadow:"0 4px 16px rgba(0,0,0,0.10)", maxHeight:200, overflowY:"auto" }}>
            {supSuggestions.map((s, i) => (
              <div key={i} onClick={() => supOnSuggestionSelect(s)} style={{ padding:"7px 12px", fontSize:12, cursor:"pointer", borderBottom:`1px solid ${B.border}` }}
                onMouseEnter={e=>e.currentTarget.style.background=B.light}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                {s}
              </div>
            ))}
          </div>
        )}
      </div>
      <SectionCard title={`Suppliers — ${rows.length} records`}>
        {viewMode === "excel"
          ? <><div className="excel-mobile-warning"><span style={{fontSize:24}}>🖥️</span><span>Excel view is only available on desktop</span></div><div className="excel-table-wrap" style={{ maxHeight: "calc(100vh - 280px)", display: "flex", flexDirection: "column", overflow: "hidden" }}><ExcelTable cols={cols} rows={supPageData} onChange={handleChange} onDelete={handleDelete} /></div></>
          : (
            <>
              <NTable cols={cols} rows={supPageData} />
              {supPageCount > 1 && (
                <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 0", fontSize:12, color:B.muted }}>
                  <button onClick={() => setSupPage(p => Math.max(0,p-1))} disabled={supPage===0} style={{ padding:"3px 10px", border:`1px solid ${B.border}`, borderRadius:5, cursor:"pointer", background:"#fff" }}>‹</button>
                  <span>Page {supPage+1} / {supPageCount}</span>
                  <button onClick={() => setSupPage(p => Math.min(supPageCount-1,p+1))} disabled={supPage===supPageCount-1} style={{ padding:"3px 10px", border:`1px solid ${B.border}`, borderRadius:5, cursor:"pointer", background:"#fff" }}>›</button>
                  <select value={supPageSize} onChange={e=>{ setSupPageSize(Number(e.target.value)); setSupPage(0); }} style={{ marginLeft:"auto", padding:"3px 6px", fontSize:11, border:`1px solid ${B.border}`, borderRadius:5 }}>
                    {[10,25,50,100].map(n=><option key={n} value={n}>{n} / page</option>)}
                  </select>
                </div>
              )}
            </>
          )}
      </SectionCard>
      {modal && <FormModal title="Add Supplier" fields={FIELDS} onSave={handleAdd} onClose={() => setModal(false)} />}
      {editModal && (
        <FormModal
          title={`Edit Supplier — ${editModal.name}`}
          fields={FIELDS}
          initialValues={editModal}
          onSave={handleEdit}
          onClose={() => setEditModal(null)}
        />
      )}

      {/* Pay balance modal */}
      {payModal !== null && (() => {
        const sup = rows[payModal] ?? data.suppliers[payModal];
        let amt = sup?.balance ?? 0;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ background: "#fff", borderRadius: 10, padding: 24, width: 340, boxShadow: "0 16px 40px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Pay Balance — {sup?.name}</div>
              <div style={{ fontSize: 12, color: B.muted }}>Outstanding: <strong style={{ color: B.red }}>{aed(sup?.balance)}</strong></div>
              <input type="number" defaultValue={sup?.balance} id="pay-input"
                style={{ border: `1px solid ${B.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", outline: "none" }}
                placeholder="Amount to pay (AED)" />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => setPayModal(null)} style={{ padding: "7px 14px", fontSize: 12, background: B.light, border: `1px solid ${B.border}`, borderRadius: 6, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                <button onClick={() => handlePayBalance(data.suppliers.findIndex(s => s.id === sup?.id), document.getElementById("pay-input")?.value)}
                  style={{ padding: "7px 14px", fontSize: 12, background: B.green, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>
                  Confirm Payment
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Linked inventory modal */}
      {linkedModal && (() => {
        const sup = data.suppliers.find(s => s.id === linkedModal);
        const items = (data.inventory || []).filter(i => i.supplier === linkedModal || i.supplier === sup?.name || i.supplier === sup?.id);
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setLinkedModal(null)}>
            <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 10, padding: 24, width: 460, maxHeight: "70vh", overflowY: "auto", boxShadow: "0 16px 40px rgba(0,0,0,0.18)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>📦 Inventory — {sup?.name}</div>
                <button onClick={() => setLinkedModal(null)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: B.muted }}>×</button>
              </div>
              {items.length === 0 ? (
                <div style={{ fontSize: 12, color: B.muted, padding: "12px 0" }}>No inventory items linked to this supplier.</div>
              ) : (
                items.map(item => (
                  <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${B.border}` }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{item.name}</div>
                      <div style={{ fontSize: 11, color: B.muted }}>{item.category} · Qty: {item.qty}</div>
                    </div>
                    <Badge label={item.status} />
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })()}
      <ToastStack toasts={toasts} />
    </div>
  );
};

export default SuppliersTab;
