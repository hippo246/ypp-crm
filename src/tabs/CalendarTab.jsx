import { useState } from "react";
import { B } from "../constants";

const CalendarTab = ({ data, setData }) => {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth());
  const [year, setYear] = useState(today.getFullYear());
  const [activeTypes, setActiveTypes] = useState(new Set(["Task", "Invoice", "Renewal"]));
  const [quickAdd, setQuickAdd] = useState(null); // { date: "YYYY-MM-DD" }
  const [quickLabel, setQuickLabel] = useState("");
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const allEvents = [
    ...data.tasks.map((t) => ({ date: t.due, label: t.title, color: t.priority === "High" ? B.red : t.priority === "Medium" ? B.yellow : B.green, type: "Task", milestone: t.milestone })),
    ...data.tasks.filter(t => t.start && t.start !== t.due).map(t => ({ date: t.start, label: `▶ ${t.title}`, color: B.accent, type: "Task" })),
    ...data.accounting.filter((i) => i.status !== "Paid").map((i) => ({ date: i.due, label: `Due: ${i.client}`, color: "#7C3AED", type: "Invoice" })),
    ...data.clients.map((c) => ({ date: c.renewal, label: `Renew: ${c.name}`, color: B.accent, type: "Renewal" })),
  ].filter(e => activeTypes.has(e.type));

  const getEvents = (d) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return allEvents.filter((e) => e.date === dateStr);
  };

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };
  const goToday = () => { setMonth(today.getMonth()); setYear(today.getFullYear()); };

  const isToday = (d) => d && today.getDate() === d && today.getMonth() === month && today.getFullYear() === year;

  const handleDayClick = (d) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    setQuickAdd({ date: dateStr });
    setQuickLabel("");
  };

  const handleQuickSave = () => {
    if (!quickLabel.trim()) { setQuickAdd(null); return; }
    const newTask = { id: `T-CAL-${Date.now()}`, title: quickLabel, assigned: "", priority: "Medium", status: "Pending", due: quickAdd.date, ref: "" };
    setData({ ...data, tasks: [...data.tasks, newTask] });
    setQuickAdd(null);
    setQuickLabel("");
  };

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const toggleType = (type) => {
    const next = new Set(activeTypes);
    next.has(type) ? next.delete(type) : next.add(type);
    setActiveTypes(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button onClick={prevMonth} style={{ padding: "4px 10px", border: `1px solid ${B.border}`, borderRadius: 5, background: B.white, cursor: "pointer", fontSize: 16 }}>‹</button>
        <span style={{ fontWeight: 700, fontSize: 14, minWidth: 160, textAlign: "center" }}>{months[month]} {year}</span>
        <button onClick={nextMonth} style={{ padding: "4px 10px", border: `1px solid ${B.border}`, borderRadius: 5, background: B.white, cursor: "pointer", fontSize: 16 }}>›</button>
        <button onClick={goToday} style={{ padding: "4px 10px", border: `1px solid ${B.blue}`, borderRadius: 5, background: B.white, cursor: "pointer", fontSize: 11, fontWeight: 600, color: B.blue }}>Today</button>
        <div style={{ display: "flex", gap: 6, marginLeft: "auto", fontSize: 11 }}>
          {[["Task", B.red], ["Invoice", "#7C3AED"], ["Renewal", B.accent]].map(([l, c]) => (
            <button key={l} onClick={() => toggleType(l)} style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 20, border: `1px solid ${activeTypes.has(l) ? c : B.border}`, background: activeTypes.has(l) ? c + "18" : B.white, cursor: "pointer", color: activeTypes.has(l) ? c : B.muted, fontWeight: activeTypes.has(l) ? 700 : 400, fontSize: 11, fontFamily: "inherit" }}>
              <span style={{ width: 7, height: 7, borderRadius: 2, background: c, display: "inline-block" }} />{l}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, background: B.border, border: `1px solid ${B.border}`, borderRadius: 8, overflow: "hidden" }}>
        {dayNames.map((d) => (
          <div key={d} style={{ background: B.light, padding: "6px 8px", fontSize: 11, fontWeight: 600, color: B.muted, textAlign: "center" }}>{d}</div>
        ))}
        {cells.map((d, i) => {
          const events = d ? getEvents(d) : [];
          const dateStr = d ? `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
          const isQuickAdd = quickAdd?.date === dateStr;
          return (
            <div key={i}
              onClick={() => d && handleDayClick(d)}
              style={{ background: d ? B.white : B.light, minHeight: 80, padding: 6, opacity: d ? 1 : 0.3, cursor: d ? "pointer" : "default", transition: "background 0.1s" }}
              onMouseEnter={(e) => { if (d) e.currentTarget.style.background = "#f0f7ff"; }}
              onMouseLeave={(e) => { if (d) e.currentTarget.style.background = B.white; }}>
              {d && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: isToday(d) ? B.blue : "transparent", color: isToday(d) ? "#fff" : B.muted }}>{d}</div>
                  {isQuickAdd ? (
                    <div onClick={e => e.stopPropagation()} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <input autoFocus value={quickLabel} onChange={e => setQuickLabel(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleQuickSave(); if (e.key === "Escape") setQuickAdd(null); }}
                        placeholder="Task title…" style={{ fontSize: 10, padding: "2px 4px", border: `1px solid ${B.blue}`, borderRadius: 3, outline: "none", width: "100%", boxSizing: "border-box" }} />
                      <div style={{ display: "flex", gap: 2 }}>
                        <button onClick={handleQuickSave} style={{ fontSize: 9, padding: "1px 5px", background: B.blue, color: "#fff", border: "none", borderRadius: 3, cursor: "pointer", flex: 1 }}>Add</button>
                        <button onClick={(e) => { e.stopPropagation(); setQuickAdd(null); }} style={{ fontSize: 9, padding: "1px 5px", background: B.light, border: `1px solid ${B.border}`, borderRadius: 3, cursor: "pointer" }}>✕</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {events.slice(0, 2).map((e, ei) => (
                        <div key={ei} style={{ fontSize: 10, background: e.color + "22", color: e.color, border: `1px solid ${e.color}44`, borderRadius: 3, padding: "1px 4px", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.milestone ? "🏁 " : ""}{e.label}</div>
                      ))}
                      {events.length > 2 && <div style={{ fontSize: 10, color: B.muted }}>+{events.length - 2} more</div>}
                      {events.length === 0 && <div style={{ fontSize: 9, color: "rgba(0,0,0,0.12)", textAlign: "center", paddingTop: 6 }}>+</div>}
                    </>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CalendarTab;
