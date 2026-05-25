import { useState } from "react";
import { B } from "../constants";

const CalendarTab = ({ data }) => {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth());
  const [year, setYear] = useState(today.getFullYear());
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const dayNames = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const allEvents = [
    ...data.tasks.map((t) => ({ date: t.due, label: t.title, color: t.priority === "High" ? B.red : t.priority === "Medium" ? B.yellow : B.green, type: "Task" })),
    ...data.accounting.filter((i) => i.status !== "Paid").map((i) => ({ date: i.due, label: `Due: ${i.client}`, color: "#7C3AED", type: "Invoice" })),
    ...data.clients.map((c) => ({ date: c.renewal, label: `Renew: ${c.name}`, color: B.accent, type: "Renewal" })),
  ];

  const getEvents = (d) => {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return allEvents.filter((e) => e.date === dateStr);
  };

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };

  const isToday = (d) => d && today.getDate() === d && today.getMonth() === month && today.getFullYear() === year;

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={prevMonth} style={{ padding: "4px 10px", border: `1px solid ${B.border}`, borderRadius: 5, background: B.white, cursor: "pointer", fontSize: 16 }}>‹</button>
        <span style={{ fontWeight: 600, fontSize: 14, minWidth: 160, textAlign: "center" }}>{months[month]} {year}</span>
        <button onClick={nextMonth} style={{ padding: "4px 10px", border: `1px solid ${B.border}`, borderRadius: 5, background: B.white, cursor: "pointer", fontSize: 16 }}>›</button>
        <div style={{ display: "flex", gap: 10, marginLeft: "auto", fontSize: 11 }}>
          {[["Task", B.red], ["Invoice", "#7C3AED"], ["Renewal", B.accent]].map(([l, c]) => (
            <span key={l} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: c, display: "inline-block" }} />{l}
            </span>
          ))}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, background: B.border, border: `1px solid ${B.border}`, borderRadius: 8, overflow: "hidden" }}>
        {dayNames.map((d) => (
          <div key={d} style={{ background: B.light, padding: "6px 8px", fontSize: 11, fontWeight: 600, color: B.muted, textAlign: "center" }}>{d}</div>
        ))}
        {cells.map((d, i) => {
          const events = d ? getEvents(d) : [];
          return (
            <div key={i} style={{ background: d ? B.white : B.light, minHeight: 80, padding: 6, opacity: d ? 1 : 0.3 }}>
              {d && (
                <>
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4, width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: isToday(d) ? B.blue : "transparent", color: isToday(d) ? "#fff" : B.muted }}>{d}</div>
                  {events.slice(0, 2).map((e, ei) => (
                    <div key={ei} style={{ fontSize: 10, background: e.color + "22", color: e.color, border: `1px solid ${e.color}44`, borderRadius: 3, padding: "1px 4px", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.label}</div>
                  ))}
                  {events.length > 2 && <div style={{ fontSize: 10, color: B.muted }}>+{events.length - 2} more</div>}
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
