import { useState, useMemo, useRef, useEffect } from "react";
import { B } from "../constants";
import { filterSearch, nextId } from "../helpers";
import Badge from "../components/Badge";
import SectionCard from "../components/SectionCard";
import NTable from "../components/NTable";
import ExcelTable from "../components/ExcelTable";
import FormModal from "../components/FormModal";

const MEMBERS = ["Anna", "Mark", "James", "Other"];
const RISK_COLORS = { High: B.red, Medium: B.orange, Low: B.green };
const APPROVAL_COLORS = { Approved: B.green, Rejected: B.red, Pending: B.orange };

// ── Progress bar ──────────────────────────────────────────────────────────────
const ProgressBar = ({ value = 0 }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
    <div style={{ flex: 1, height: 6, background: B.border, borderRadius: 4, overflow: "hidden" }}>
      <div style={{ width: `${value}%`, height: "100%", background: value === 100 ? B.green : value > 50 ? B.accent : B.orange, borderRadius: 4, transition: "width 0.3s" }} />
    </div>
    <span style={{ fontSize: 10, color: B.muted, width: 28, textAlign: "right" }}>{value}%</span>
  </div>
);

// ── Kanban column ─────────────────────────────────────────────────────────────
const KanbanCol = ({ status, tasks, onDrop, onDragStart, onEdit }) => (
  <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); onDrop(status); }}
    style={{ flex: 1, minWidth: 220, background: B.light, borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 8, minHeight: 300 }}>
    <div style={{ fontWeight: 700, fontSize: 12, color: B.text, marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
      <Badge label={status} /><span style={{ color: B.muted, fontWeight: 400 }}>({tasks.length})</span>
    </div>
    {tasks.map(t => (
      <div key={t.id} draggable onDragStart={() => onDragStart(t.id)}
        onClick={() => onEdit(t)}
        style={{ background: "#fff", borderRadius: 8, padding: "10px 12px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", cursor: "grab", border: `1px solid ${B.border}`, transition: "box-shadow 0.15s" }}
        onMouseEnter={e => e.currentTarget.style.boxShadow = "0 3px 10px rgba(0,0,0,0.12)"}
        onMouseLeave={e => e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.07)"}>
        <div style={{ fontSize: 12, fontWeight: 600, color: B.text, marginBottom: 6 }}>{t.milestone && "🏁 "}{t.title}</div>
        <ProgressBar value={t.progress || 0} />
        <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
          <Badge label={t.priority} />
          {t.risk && t.risk !== "Low" && <span style={{ fontSize: 9, fontWeight: 700, color: RISK_COLORS[t.risk], background: RISK_COLORS[t.risk] + "18", borderRadius: 4, padding: "1px 5px" }}>⚠ {t.risk} risk</span>}
          {t.bottleneck && <span style={{ fontSize: 9, fontWeight: 700, color: B.red, background: B.red + "18", borderRadius: 4, padding: "1px 5px" }}>🚧 Bottleneck</span>}
          {t.recurring && <span style={{ fontSize: 9, color: B.accent, background: B.accent + "18", borderRadius: 4, padding: "1px 5px" }}>🔁 {t.recurring}</span>}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: B.muted }}>
          <span>👤 {t.assigned || "—"}</span>
          <span style={{ color: t.due && (new Date(t.due) - new Date()) / 86400000 < 0 ? B.red : B.muted }}>{t.due || "—"}</span>
        </div>
        {(t.subtasks || []).length > 0 && (
          <div style={{ fontSize: 10, color: B.muted, marginTop: 4 }}>
            ☑ {(t.subtasks).filter(s => s.done).length}/{t.subtasks.length} subtasks
          </div>
        )}
        {(t.comments || []).length > 0 && <div style={{ fontSize: 10, color: B.muted, marginTop: 2 }}>💬 {t.comments.length}</div>}
      </div>
    ))}
  </div>
);

// ── Timeline / Gantt row ──────────────────────────────────────────────────────
const GanttView = ({ tasks }) => {
  const today = new Date();
  const allDates = tasks.flatMap(t => [t.start, t.due]).filter(Boolean).map(d => new Date(d));
  const minDate = allDates.length ? new Date(Math.min(...allDates)) : new Date();
  const maxDate = allDates.length ? new Date(Math.max(...allDates)) : new Date(today.getTime() + 30 * 86400000);
  const totalDays = Math.max(1, (maxDate - minDate) / 86400000) + 4;
  const toX = (d) => d ? Math.max(0, ((new Date(d) - minDate) / 86400000) / totalDays * 100) : 0;
  const toW = (s, e) => s && e ? Math.max(0.5, ((new Date(e) - new Date(s)) / 86400000) / totalDays * 100) : 1;
  const todayX = ((today - minDate) / 86400000) / totalDays * 100;
  return (
    <div style={{ overflowX: "auto", padding: "8px 0" }}>
      <div style={{ minWidth: 700, position: "relative" }}>
        {/* Today line */}
        <div style={{ position: "absolute", left: `${todayX}%`, top: 0, bottom: 0, width: 2, background: B.red, opacity: 0.5, zIndex: 2 }} />
        {tasks.map((t, i) => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, height: 32 }}>
            <div style={{ width: 180, fontSize: 11, color: B.text, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={t.title}>{t.milestone ? "🏁 " : ""}{t.title}</div>
            <div style={{ flex: 1, height: 20, background: B.border, borderRadius: 4, position: "relative" }}>
              <div style={{ position: "absolute", left: `${toX(t.start)}%`, width: `${toW(t.start, t.due)}%`, height: "100%", background: t.milestone ? B.orange : t.status === "Done" ? B.green : t.status === "In Progress" ? B.accent : B.muted, borderRadius: 4, minWidth: 4, transition: "all 0.2s", opacity: 0.85 }} title={`${t.start || "?"} → ${t.due || "?"}`} />
              <div style={{ position: "absolute", left: `${toX(t.start)}%`, width: `${toW(t.start, t.due) * (t.progress || 0) / 100}%`, height: "100%", background: B.blue, borderRadius: 4, opacity: 0.6 }} />
            </div>
            <div style={{ width: 60, fontSize: 10, color: B.muted, flexShrink: 0 }}><Badge label={t.status} /></div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Calendar view ─────────────────────────────────────────────────────────────
const CalendarView = ({ tasks, onOpenDetail, onQuickAdd }) => {
  const [calDate, setCalDate] = useState(new Date());
  const [quickDay, setQuickDay] = useState(null);
  const [quickTitle, setQuickTitle] = useState("");

  const year = calDate.getFullYear();
  const month = calDate.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date().toISOString().slice(0, 10);

  const tasksByDay = useMemo(() => {
    const map = {};
    tasks.forEach(t => {
      if (!t.due) return;
      const d = t.due.slice(0, 10);
      if (!map[d]) map[d] = [];
      map[d].push(t);
    });
    return map;
  }, [tasks]);

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const monthStr = calDate.toLocaleString("en-GB", { month: "long", year: "numeric" });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: `1px solid ${B.border}` }}>
        <button onClick={() => setCalDate(new Date(year, month - 1, 1))}
          style={{ background: "none", border: `1px solid ${B.border}`, borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 13 }}>‹</button>
        <span style={{ fontWeight: 700, fontSize: 13 }}>{monthStr}</span>
        <button onClick={() => setCalDate(new Date(year, month + 1, 1))}
          style={{ background: "none", border: `1px solid ${B.border}`, borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontSize: 13 }}>›</button>
      </div>
      {/* Day labels */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", background: B.light }}>
        {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => (
          <div key={d} style={{ padding: "6px 0", textAlign: "center", fontSize: 10, fontWeight: 700, color: B.muted }}>{d}</div>
        ))}
      </div>
      {/* Day cells */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", flex: 1 }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} style={{ borderRight: `1px solid ${B.border}`, borderBottom: `1px solid ${B.border}`, minHeight: 80, background: "#fafafa" }} />;
          const dateStr = `${year}-${String(month + 1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
          const dayTasks = tasksByDay[dateStr] || [];
          const isToday = dateStr === today;
          const isQuick = quickDay === dateStr;
          return (
            <div key={day}
              style={{ borderRight: `1px solid ${B.border}`, borderBottom: `1px solid ${B.border}`, minHeight: 80, padding: "4px 5px", background: isToday ? B.blue + "08" : "#fff", cursor: "pointer", position: "relative" }}
              onClick={() => { setQuickDay(isQuick ? null : dateStr); setQuickTitle(""); }}>
              <div style={{ fontSize: 11, fontWeight: isToday ? 800 : 500, color: isToday ? B.blue : B.text,
                width: 20, height: 20, borderRadius: "50%", background: isToday ? B.blue : "transparent",
                color: isToday ? "#fff" : B.text, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 3 }}>
                {day}
              </div>
              {dayTasks.slice(0, 3).map(t => (
                <div key={t.id} onClick={e => { e.stopPropagation(); onOpenDetail(t); }}
                  style={{ fontSize: 9, padding: "1px 4px", borderRadius: 3, marginBottom: 2, background: t.status === "Done" ? B.green + "22" : t.priority === "High" ? B.red + "22" : B.blue + "18", color: t.status === "Done" ? B.green : t.priority === "High" ? B.red : B.blue, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}>
                  {t.title}
                </div>
              ))}
              {dayTasks.length > 3 && <div style={{ fontSize: 9, color: B.muted }}>+{dayTasks.length - 3} more</div>}
              {/* Quick-add inline */}
              {isQuick && (
                <div onClick={e => e.stopPropagation()} style={{ position: "absolute", top: "100%", left: 0, zIndex: 50, background: "#fff", border: `1px solid ${B.border}`, borderRadius: 7, padding: 8, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: 200 }}>
                  <div style={{ fontSize: 10, color: B.muted, marginBottom: 4 }}>Add task for {dateStr}</div>
                  <input autoFocus value={quickTitle} onChange={e => setQuickTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter" && quickTitle.trim()) { onQuickAdd(quickTitle, dateStr); setQuickDay(null); setQuickTitle(""); } if (e.key === "Escape") setQuickDay(null); }}
                    placeholder="Task title… Enter to save"
                    style={{ width: "100%", fontSize: 11, padding: "4px 7px", border: `1px solid ${B.border}`, borderRadius: 5, fontFamily: "inherit", boxSizing: "border-box", outline: "none" }} />
                  <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                    <button onClick={() => { if (quickTitle.trim()) { onQuickAdd(quickTitle, dateStr); setQuickDay(null); setQuickTitle(""); }}}
                      style={{ flex: 1, padding: "4px 0", background: B.blue, color: "#fff", border: "none", borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: "pointer" }}>Add</button>
                    <button onClick={() => setQuickDay(null)}
                      style={{ padding: "4px 8px", background: "none", border: `1px solid ${B.border}`, borderRadius: 4, fontSize: 10, cursor: "pointer", color: B.muted }}>✕</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── Private Notes (per-user, localStorage) ────────────────────────────────────
const PrivateNotes = ({ members }) => {
  const [identity, setIdentity] = useState(() => localStorage.getItem("ypp_notes_user") || "");
  const [notes, setNotes] = useState(() => {
    try { return JSON.parse(localStorage.getItem("ypp_private_notes") || "{}"); } catch { return {}; }
  });
  const [draft, setDraft] = useState("");
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    if (identity) {
      localStorage.setItem("ypp_notes_user", identity);
      setDraft(notes[identity] || "");
      setUnlocked(true);
    }
  }, [identity]);

  const save = () => {
    const updated = { ...notes, [identity]: draft };
    setNotes(updated);
    localStorage.setItem("ypp_private_notes", JSON.stringify(updated));
  };

  const switchUser = () => {
    save();
    setIdentity("");
    setUnlocked(false);
    setDraft("");
  };

  if (!unlocked) {
    return (
      <div style={{ padding: 24, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div style={{ fontSize: 28 }}>🔒</div>
        <div style={{ fontWeight: 700, fontSize: 14, color: B.text }}>Private Notes</div>
        <div style={{ fontSize: 12, color: B.muted, textAlign: "center", maxWidth: 280 }}>
          Your notes are private — only visible to you. Select your identity to continue.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%", maxWidth: 260 }}>
          {members.map(m => (
            <button key={m} onClick={() => setIdentity(m)}
              style={{ padding: "10px 16px", border: `1px solid ${B.border}`, borderRadius: 8, background: B.white, cursor: "pointer", fontSize: 13, fontWeight: 600, color: B.text, display: "flex", alignItems: "center", gap: 10 }}
              onMouseEnter={e => e.currentTarget.style.background = B.light}
              onMouseLeave={e => e.currentTarget.style.background = B.white}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: B.accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{m[0]}</div>
              {m}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: B.accent, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{identity[0]}</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13, color: B.text }}>{identity}'s Notes</div>
            <div style={{ fontSize: 10, color: B.muted }}>Private — only you can see this</div>
          </div>
        </div>
        <button onClick={switchUser} style={{ fontSize: 11, color: B.muted, background: "none", border: `1px solid ${B.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>
          Switch user
        </button>
      </div>
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        rows={12}
        placeholder="Your private notes… only you can see this."
        style={{ width: "100%", fontSize: 12, padding: "10px 12px", border: `1px solid ${B.border}`, borderRadius: 8, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box", lineHeight: 1.6, outline: "none" }}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 10, color: B.muted }}>{draft.length} chars</span>
        <button onClick={save}
          style={{ padding: "6px 18px", background: B.blue, color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
          Save Notes
        </button>
      </div>
    </div>
  );
};


const TaskDetailPanel = ({ task, taskIndex, allTasks, onClose, onUpdate, onAddComment, onToggleSubtask, onSetApproval, currentUser }) => {
  const [newComment, setNewComment] = useState("");
  const [newSubtask, setNewSubtask] = useState("");
  const [mentionSearch, setMentionSearch] = useState(null);
  const attachInputRef = useRef(null);

  const handleAttachFile = (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const newAttach = { id: `AT${Date.now()}${Math.random().toString(36).slice(2,6)}`, name: file.name, size: file.size, type: file.type, data: ev.target.result, uploadedAt: new Date().toISOString() };
        onUpdate(taskIndex, "attachments", [...(task.attachments || []), newAttach]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  };

  const removeAttach = (id) => {
    onUpdate(taskIndex, "attachments", (task.attachments || []).filter(a => a.id !== id));
  };

  const handleCommentChange = (e) => {
    const val = e.target.value;
    setNewComment(val);
    const atIdx = val.lastIndexOf("@");
    if (atIdx >= 0 && atIdx === val.length - 1) setMentionSearch("");
    else if (atIdx >= 0 && !val.slice(atIdx + 1).includes(" ")) setMentionSearch(val.slice(atIdx + 1));
    else setMentionSearch(null);
  };

  const insertMention = (name) => {
    const atIdx = newComment.lastIndexOf("@");
    setNewComment(newComment.slice(0, atIdx) + `@${name} `);
    setMentionSearch(null);
  };

  const submitComment = () => {
    if (!newComment.trim()) return;
    const mentions = [...newComment.matchAll(/@(\w+)/g)].map(m => m[1]);
    onAddComment(taskIndex, newComment, mentions);
    setNewComment("");
  };

  return (
    <div style={{ position: "fixed", right: 0, top: 0, bottom: 0, width: 420, background: "#fff", boxShadow: "-4px 0 24px rgba(0,0,0,0.13)", zIndex: 800, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${B.border}`, display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: B.text }}>{task.milestone ? "🏁 " : ""}{task.title}</div>
          <div style={{ fontSize: 10, color: B.muted, marginTop: 2 }}>{task.id} · {task.ref || "No ref"}</div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: B.muted, lineHeight: 1 }}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Core fields */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[["Status", "status", ["Pending","In Progress","In Review","Done","Blocked"]], ["Priority", "priority", ["High","Medium","Low"]], ["Risk", "risk", ["High","Medium","Low"]], ["Recurring", "recurring", [null,"daily","weekly","monthly"]]].map(([label, key, opts]) => (
            <label key={key} style={{ fontSize: 11 }}>
              <div style={{ color: B.muted, marginBottom: 2 }}>{label}</div>
              <select value={task[key] || ""} onChange={e => onUpdate(taskIndex, key, e.target.value || null)}
                style={{ width: "100%", padding: "4px 6px", border: `1px solid ${B.border}`, borderRadius: 5, fontSize: 11, fontFamily: "inherit" }}>
                {opts.map(o => <option key={o} value={o || ""}>{o || "None"}</option>)}
              </select>
            </label>
          ))}
          {[["Start", "start"], ["Due", "due"]].map(([label, key]) => (
            <label key={key} style={{ fontSize: 11 }}>
              <div style={{ color: B.muted, marginBottom: 2 }}>{label}</div>
              <input type="date" value={task[key] || ""} onChange={e => onUpdate(taskIndex, key, e.target.value)}
                style={{ width: "100%", padding: "4px 6px", border: `1px solid ${B.border}`, borderRadius: 5, fontSize: 11, fontFamily: "inherit" }} />
            </label>
          ))}
          <label style={{ fontSize: 11 }}>
            <div style={{ color: B.muted, marginBottom: 2 }}>Assigned</div>
            <select value={task.assigned || ""} onChange={e => onUpdate(taskIndex, "assigned", e.target.value)}
              style={{ width: "100%", padding: "4px 6px", border: `1px solid ${B.border}`, borderRadius: 5, fontSize: 11, fontFamily: "inherit" }}>
              {MEMBERS.map(m => <option key={m}>{m}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 11 }}>
            <div style={{ color: B.muted, marginBottom: 2 }}>Reviewer</div>
            <select value={task.reviewAssignee || ""} onChange={e => onUpdate(taskIndex, "reviewAssignee", e.target.value)}
              style={{ width: "100%", padding: "4px 6px", border: `1px solid ${B.border}`, borderRadius: 5, fontSize: 11, fontFamily: "inherit" }}>
              <option value="">None</option>
              {MEMBERS.map(m => <option key={m}>{m}</option>)}
            </select>
          </label>
        </div>

        {/* Progress */}
        <div>
          <div style={{ fontSize: 11, color: B.muted, marginBottom: 4 }}>Progress</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="range" min={0} max={100} value={task.progress || 0} onChange={e => onUpdate(taskIndex, "progress", Number(e.target.value))} style={{ flex: 1 }} />
            <span style={{ fontSize: 11, width: 32, textAlign: "right" }}>{task.progress || 0}%</span>
          </div>
        </div>

        {/* Flags */}
        <div style={{ display: "flex", gap: 10 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, cursor: "pointer" }}>
            <input type="checkbox" checked={!!task.milestone} onChange={e => onUpdate(taskIndex, "milestone", e.target.checked)} /> 🏁 Milestone
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, cursor: "pointer" }}>
            <input type="checkbox" checked={!!task.bottleneck} onChange={e => onUpdate(taskIndex, "bottleneck", e.target.checked)} /> 🚧 Bottleneck
          </label>
        </div>

        {/* Dependencies */}
        <div>
          <div style={{ fontSize: 11, color: B.muted, marginBottom: 4 }}>Dependencies</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {(task.dependsOn || []).map(dep => (
              <span key={dep} style={{ fontSize: 10, background: B.light, border: `1px solid ${B.border}`, borderRadius: 4, padding: "2px 8px", display: "flex", alignItems: "center", gap: 4 }}>
                {dep}
                <button onClick={() => onUpdate(taskIndex, "dependsOn", (task.dependsOn || []).filter(d => d !== dep))} style={{ background: "none", border: "none", cursor: "pointer", color: B.muted, padding: 0, fontSize: 10 }}>✕</button>
              </span>
            ))}
            <select onChange={e => { if (e.target.value && !(task.dependsOn || []).includes(e.target.value)) onUpdate(taskIndex, "dependsOn", [...(task.dependsOn || []), e.target.value]); e.target.value = ""; }}
              style={{ fontSize: 10, padding: "2px 4px", border: `1px solid ${B.border}`, borderRadius: 4, fontFamily: "inherit" }}>
              <option value="">+ Add dep</option>
              {allTasks.filter(t => t.id !== task.id).map(t => <option key={t.id} value={t.id}>{t.id}: {t.title.slice(0, 30)}</option>)}
            </select>
          </div>
        </div>

        {/* Team */}
        <div>
          <div style={{ fontSize: 11, color: B.muted, marginBottom: 4 }}>Team</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {MEMBERS.map(m => (
              <button key={m} onClick={() => {
                const team = task.team || [];
                onUpdate(taskIndex, "team", team.includes(m) ? team.filter(x => x !== m) : [...team, m]);
              }} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, border: `1px solid ${(task.team || []).includes(m) ? B.blue : B.border}`, background: (task.team || []).includes(m) ? B.blue + "18" : "#fff", color: (task.team || []).includes(m) ? B.blue : B.muted, cursor: "pointer" }}>
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Subtasks */}
        <div>
          <div style={{ fontSize: 11, color: B.muted, marginBottom: 6 }}>Subtasks</div>
          {(task.subtasks || []).map(s => (
            <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginBottom: 4, cursor: "pointer" }}>
              <input type="checkbox" checked={s.done} onChange={() => onToggleSubtask(taskIndex, s.id)} />
              <span style={{ textDecoration: s.done ? "line-through" : "none", color: s.done ? B.muted : B.text }}>{s.title}</span>
            </label>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <input value={newSubtask} onChange={e => setNewSubtask(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && newSubtask.trim()) { onUpdate(taskIndex, "subtasks", [...(task.subtasks || []), { id: `ST${Date.now()}`, title: newSubtask, done: false }]); setNewSubtask(""); } }}
              placeholder="Add subtask…" style={{ flex: 1, fontSize: 11, padding: "4px 8px", border: `1px solid ${B.border}`, borderRadius: 5, fontFamily: "inherit" }} />
          </div>
        </div>

        {/* Approval */}
        {task.approvalStatus !== null && task.approvalStatus !== undefined && (
          <div>
            <div style={{ fontSize: 11, color: B.muted, marginBottom: 4 }}>Approval</div>
            <div style={{ display: "flex", gap: 6 }}>
              {["Approved", "Rejected", "Pending"].map(s => (
                <button key={s} onClick={() => onSetApproval(taskIndex, s)}
                  style={{ fontSize: 10, padding: "3px 10px", borderRadius: 20, border: `1px solid ${task.approvalStatus === s ? APPROVAL_COLORS[s] : B.border}`, background: task.approvalStatus === s ? APPROVAL_COLORS[s] + "18" : "#fff", color: task.approvalStatus === s ? APPROVAL_COLORS[s] : B.muted, cursor: "pointer", fontWeight: task.approvalStatus === s ? 700 : 400 }}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        <div>
          <div style={{ fontSize: 11, color: B.muted, marginBottom: 4 }}>Notes</div>
          <textarea value={task.notes || ""} onChange={e => onUpdate(taskIndex, "notes", e.target.value)} rows={3}
            style={{ width: "100%", fontSize: 11, padding: "6px 8px", border: `1px solid ${B.border}`, borderRadius: 5, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box" }} placeholder="Add notes…" />
        </div>

        {/* Attachments */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontSize: 11, color: B.muted }}>Attachments ({(task.attachments || []).length})</div>
            <button onClick={() => attachInputRef.current?.click()}
              style={{ fontSize: 10, padding: "3px 10px", background: B.blue, color: "#fff", border: "none", borderRadius: 5, cursor: "pointer", fontWeight: 600 }}>
              + Attach File
            </button>
            <input ref={attachInputRef} type="file" multiple style={{ display: "none" }} onChange={handleAttachFile} />
          </div>
          {(task.attachments || []).length === 0 ? (
            <div style={{ fontSize: 11, color: B.muted, fontStyle: "italic", padding: "6px 0" }}>No attachments yet</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {(task.attachments || []).map(a => {
                const isImage = a.type?.startsWith("image/");
                const sizeKb = (a.size / 1024).toFixed(1);
                return (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, background: B.light, borderRadius: 6, padding: "6px 10px", border: `1px solid ${B.border}` }}>
                    <span style={{ fontSize: 16 }}>{isImage ? "🖼" : a.type?.includes("pdf") ? "📄" : a.type?.includes("sheet") || a.name?.endsWith(".xlsx") ? "📊" : "📎"}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: B.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                      <div style={{ fontSize: 9, color: B.muted }}>{sizeKb} KB · {new Date(a.uploadedAt).toLocaleDateString()}</div>
                    </div>
                    {isImage && (
                      <img src={a.data} alt={a.name} style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 4, border: `1px solid ${B.border}` }} />
                    )}
                    <a href={a.data} download={a.name}
                      style={{ fontSize: 10, color: B.blue, textDecoration: "none", padding: "2px 7px", border: `1px solid ${B.blue}`, borderRadius: 4 }}>
                      ↓
                    </a>
                    <button onClick={() => removeAttach(a.id)}
                      style={{ background: "none", border: "none", cursor: "pointer", color: B.muted, fontSize: 12, padding: "0 2px" }}>✕</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Comments */}
        <div>
          <div style={{ fontSize: 11, color: B.muted, marginBottom: 6 }}>Comments</div>
          {(task.comments || []).map(c => (
            <div key={c.id} style={{ background: B.light, borderRadius: 6, padding: "8px 10px", marginBottom: 6, fontSize: 11 }}>
              <div style={{ fontWeight: 700, color: B.text, marginBottom: 2 }}>{c.author} <span style={{ fontWeight: 400, color: B.muted, fontSize: 10 }}>{new Date(c.time).toLocaleString()}</span></div>
              <div style={{ color: B.text }}>{c.text}</div>
            </div>
          ))}
          <div style={{ position: "relative" }}>
            <textarea value={newComment} onChange={handleCommentChange} rows={2} placeholder="Comment… type @ to mention"
              style={{ width: "100%", fontSize: 11, padding: "6px 8px", border: `1px solid ${B.border}`, borderRadius: 5, fontFamily: "inherit", resize: "none", boxSizing: "border-box" }} />
            {mentionSearch !== null && (
              <div style={{ position: "absolute", bottom: "100%", left: 0, background: "#fff", border: `1px solid ${B.border}`, borderRadius: 6, boxShadow: "0 4px 12px rgba(0,0,0,0.1)", zIndex: 10, overflow: "hidden" }}>
                {MEMBERS.filter(m => m.toLowerCase().startsWith(mentionSearch.toLowerCase())).map(m => (
                  <div key={m} onClick={() => insertMention(m)} style={{ padding: "6px 12px", fontSize: 11, cursor: "pointer" }} onMouseEnter={e => e.currentTarget.style.background = B.light} onMouseLeave={e => e.currentTarget.style.background = "#fff"}>@{m}</div>
                ))}
              </div>
            )}
            <button onClick={submitComment} style={{ marginTop: 4, padding: "4px 12px", background: B.blue, color: "#fff", border: "none", borderRadius: 5, fontSize: 11, cursor: "pointer", fontWeight: 600 }}>Send</button>
          </div>
        </div>

        {/* Activity log */}
        {(task.activityLog || []).length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: B.muted, marginBottom: 6 }}>Activity</div>
            {[...(task.activityLog || [])].reverse().slice(0, 10).map((a, i) => (
              <div key={i} style={{ fontSize: 10, color: B.muted, borderLeft: `2px solid ${B.border}`, paddingLeft: 8, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: B.text }}>{a.user}</span> {a.text} · {new Date(a.time).toLocaleString()}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const FIELDS = [
  { key: "title", label: "Task Title", placeholder: "Task description" },
  { key: "assigned", label: "Assigned To", type: "select", options: MEMBERS },
  { key: "reviewAssignee", label: "Reviewer", type: "select", options: ["", ...MEMBERS] },
  { key: "priority", label: "Priority", type: "select", options: ["High", "Medium", "Low"] },
  { key: "status", label: "Status", type: "select", options: ["Pending", "In Progress", "In Review", "Done", "Blocked"] },
  { key: "due", label: "Due Date", type: "date" },
  { key: "start", label: "Start Date", type: "date" },
  { key: "risk", label: "Risk Level", type: "select", options: ["High", "Medium", "Low"] },
  { key: "ref", label: "Reference (optional)", placeholder: "L001, C001..." },
];

const TasksTab = ({ data, setData, viewMode, search }) => {
  const [filter, setFilter] = useState("All");
  const [taskView, setTaskView] = useState("list"); // list | kanban | gantt | calendar
  const [modal, setModal] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [quickTitle, setQuickTitle] = useState("");
  const [detailTask, setDetailTask] = useState(null); // { task, index }
  const [templateModal, setTemplateModal] = useState(false);
  const [versionModal, setVersionModal] = useState(false);
  const [colabFilter, setColabFilter] = useState("All"); // for collaboration filter
  const [notesOpen, setNotesOpen] = useState(false);
  const dragRef = useRef(null);
  const statuses = ["All", "Pending", "In Progress", "In Review", "Done", "Blocked"];

  let rows = filter === "All" ? data.tasks : data.tasks.filter((t) => t.status === filter);
  rows = filterSearch(rows, search, ["title", "assigned", "ref"]);
  if (colabFilter !== "All") rows = rows.filter(t => t.assigned === colabFilter || (t.team || []).includes(colabFilter));

  // Workload map
  const workload = useMemo(() => {
    const map = {};
    (data.tasks || []).forEach(t => {
      if (t.status === "Done") return;
      [t.assigned, ...(t.team || [])].filter(Boolean).forEach(m => { map[m] = (map[m] || 0) + 1; });
    });
    return map;
  }, [data.tasks]);

  function dueDateColor(due) {
    if (!due) return B.muted;
    const diff = (new Date(due) - new Date()) / 86_400_000;
    if (diff < 0) return B.red;
    if (diff <= 1) return B.orange;
    return B.muted;
  }

  const cols = [
    { key: "id", label: "ID", width: 70 },
    { key: "title", label: "Task", width: 240, render: (v, row) => <span>{row?.milestone ? "🏁 " : ""}{row?.bottleneck ? "🚧 " : ""}{v}</span> },
    { key: "assigned", label: "Assigned", width: 90 },
    { key: "reviewAssignee", label: "Reviewer", width: 80, render: v => v ? <span style={{ fontSize: 11, color: B.accent }}>👁 {v}</span> : <span style={{ color: B.border }}>—</span> },
    { key: "priority", label: "Priority", width: 90, render: (v) => <Badge label={v} /> },
    { key: "status", label: "Status", width: 110, render: (v) => <Badge label={v} /> },
    { key: "progress", label: "Progress", width: 120, render: (v) => <ProgressBar value={v || 0} /> },
    { key: "risk", label: "Risk", width: 80, render: v => v ? <span style={{ fontSize: 11, fontWeight: 600, color: RISK_COLORS[v] || B.muted }}>{v}</span> : null },
    { key: "due", label: "Due Date", width: 110, render: (v) => <span style={{ color: dueDateColor(v), fontWeight: dueDateColor(v) !== B.muted ? 700 : 400 }}>{v || "—"}{v && (new Date(v) - new Date()) / 86_400_000 < 0 ? " ⚠" : ""}</span> },
    { key: "start", label: "Start", width: 100, render: v => <span style={{ color: B.muted, fontSize: 11 }}>{v || "—"}</span> },
    { key: "recurring", label: "Recurring", width: 80, render: v => v ? <span style={{ fontSize: 10, color: B.accent }}>🔁 {v}</span> : null },
    { key: "approvalStatus", label: "Approval", width: 90, render: v => v ? <span style={{ fontSize: 10, fontWeight: 700, color: APPROVAL_COLORS[v] || B.muted }}>{v}</span> : null },
    { key: "ref", label: "Reference", width: 90 },
  ];

  const handleChange = (ri, key, val) => {
    const updated = [...data.tasks];
    updated[ri] = { ...updated[ri], [key]: val };
    setData({ ...data, tasks: updated });
  };

  const handleDelete = (ri) => {
    const updated = [...data.tasks];
    updated.splice(ri, 1);
    setData({ ...data, tasks: updated });
  };

  const handleAdd = (vals) => {
    setData({ ...data, tasks: [...data.tasks, { id: nextId("T"), progress: 0, subtasks: [], dependsOn: [], team: [], comments: [], attachments: [], activityLog: [], notes: "", bottleneck: false, milestone: false, recurring: null, approvalStatus: null, reviewAssignee: "", risk: "Low", start: "", ...vals }] });
  };

  const handleBulkComplete = () => {
    const updated = data.tasks.map(t => selected.has(t.id) ? { ...t, status: "Done", progress: 100 } : t);
    setData({ ...data, tasks: updated });
    setSelected(new Set());
  };

  const handleQuickAdd = () => {
    if (!quickTitle.trim()) return;
    setData({ ...data, tasks: [...data.tasks, { id: nextId("T"), title: quickTitle, assigned: "", reviewAssignee: "", team: [], priority: "Medium", status: "Pending", due: "", start: "", ref: "", progress: 0, risk: "Low", subtasks: [], dependsOn: [], recurring: null, milestone: false, notes: "", comments: [], attachments: [], activityLog: [], bottleneck: false, approvalStatus: null }] });
    setQuickTitle("");
  };

  const handleKanbanDrop = (newStatus) => {
    if (!dragRef.current) return;
    const idx = data.tasks.findIndex(t => t.id === dragRef.current);
    if (idx < 0) return;
    handleChange(idx, "status", newStatus);
    dragRef.current = null;
  };

  const handleAddComment = (taskIndex, text, mentions) => {
    const updated = [...data.tasks];
    const t = updated[taskIndex];
    const comment = { id: `CM${Date.now()}`, author: "You", text, time: new Date().toISOString(), mentions };
    updated[taskIndex] = { ...t, comments: [...(t.comments || []), comment], activityLog: [...(t.activityLog || []), { type: "comment", user: "You", time: comment.time, text: `Commented: "${text.slice(0, 40)}"` }] };
    setData({ ...data, tasks: updated });
    if (detailTask) setDetailTask({ ...detailTask, task: updated[taskIndex] });
  };

  const handleToggleSubtask = (taskIndex, subtaskId) => {
    const updated = [...data.tasks];
    const t = { ...updated[taskIndex] };
    t.subtasks = (t.subtasks || []).map(s => s.id === subtaskId ? { ...s, done: !s.done } : s);
    const done = t.subtasks.filter(s => s.done).length;
    t.progress = t.subtasks.length ? Math.round((done / t.subtasks.length) * 100) : t.progress;
    updated[taskIndex] = t;
    setData({ ...data, tasks: updated });
    if (detailTask) setDetailTask({ ...detailTask, task: updated[taskIndex] });
  };

  const handleSetApproval = (taskIndex, status) => {
    const updated = [...data.tasks];
    const t = updated[taskIndex];
    updated[taskIndex] = { ...t, approvalStatus: status, activityLog: [...(t.activityLog || []), { type: "approval", user: "You", time: new Date().toISOString(), text: `Approval set to ${status}` }] };
    setData({ ...data, tasks: updated });
    if (detailTask) setDetailTask({ ...detailTask, task: updated[taskIndex] });
  };

  const openDetail = (task) => {
    const index = data.tasks.findIndex(t => t.id === task.id);
    setDetailTask({ task, index });
  };

  const handleDetailUpdate = (taskIndex, key, val) => {
    handleChange(taskIndex, key, val);
    const updated = [...data.tasks];
    updated[taskIndex] = { ...updated[taskIndex], [key]: val };
    setDetailTask({ task: updated[taskIndex], index: taskIndex });
  };

  // Template presets
  const TEMPLATES = [
    { label: "Visa Follow-up", vals: { title: "Follow up on visa docs", priority: "High", status: "Pending", risk: "High" } },
    { label: "License Renewal", vals: { title: "Renew business license", priority: "High", status: "Pending", milestone: true, risk: "Medium" } },
    { label: "Client Call", vals: { title: "Schedule client call", priority: "Medium", status: "Pending", recurring: "weekly" } },
    { label: "Invoice Reminder", vals: { title: "Send invoice reminder", priority: "Medium", status: "Pending", recurring: "monthly" } },
  ];

  const overdueCount = data.tasks.filter(t => t.status !== "Done" && t.due && (new Date(t.due) - new Date()) / 86_400_000 < 0).length;
  const todayCount = data.tasks.filter(t => t.status !== "Done" && t.due && Math.abs((new Date(t.due) - new Date()) / 86_400_000) <= 1).length;
  const bottleneckCount = data.tasks.filter(t => t.bottleneck && t.status !== "Done").length;
  const milestoneCount = data.tasks.filter(t => t.milestone && t.status !== "Done").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Summary chips */}
      {(overdueCount > 0 || todayCount > 0 || bottleneckCount > 0 || milestoneCount > 0) && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {overdueCount > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: B.red, background: B.red + "0f", border: `1px solid ${B.red}30`, borderRadius: 20, padding: "3px 10px" }}>⚠ {overdueCount} overdue</div>}
          {todayCount > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: B.orange, background: B.orange + "0f", border: `1px solid ${B.orange}30`, borderRadius: 20, padding: "3px 10px" }}>⏰ {todayCount} due today</div>}
          {bottleneckCount > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: B.red, background: B.red + "0f", border: `1px solid ${B.red}30`, borderRadius: 20, padding: "3px 10px" }}>🚧 {bottleneckCount} bottleneck{bottleneckCount > 1 ? "s" : ""}</div>}
          {milestoneCount > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: B.orange, background: B.orange + "0f", border: `1px solid ${B.orange}30`, borderRadius: 20, padding: "3px 10px" }}>🏁 {milestoneCount} milestone{milestoneCount > 1 ? "s" : ""}</div>}
        </div>
      )}

      {/* Workload bar */}
      {Object.keys(workload).length > 0 && (
        <div style={{ display: "flex", gap: 10, background: B.light, borderRadius: 8, padding: "8px 14px", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: B.muted, letterSpacing: "0.5px" }}>WORKLOAD</span>
          {Object.entries(workload).map(([name, count]) => (
            <div key={name} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11 }}>
              <div style={{ width: 20, height: 20, borderRadius: "50%", background: B.accent, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 9, fontWeight: 700 }}>{name[0]}</div>
              <span style={{ color: B.text, fontWeight: 600 }}>{name}</span>
              <span style={{ background: count >= 4 ? B.red + "18" : B.light, color: count >= 4 ? B.red : B.muted, borderRadius: 10, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>{count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          {/* Status filters */}
          {statuses.map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              style={{ padding: "4px 14px", borderRadius: 20, fontSize: 11, border: `1px solid ${filter === s ? B.blue : B.border}`, background: filter === s ? B.blue : B.white, color: filter === s ? "#fff" : B.muted, cursor: "pointer", fontWeight: filter === s ? 600 : 400 }}>
              {s}
            </button>
          ))}
          {selected.size > 0 && (
            <button onClick={handleBulkComplete} style={{ padding: "4px 14px", borderRadius: 20, fontSize: 11, background: B.green, color: "#fff", border: "none", cursor: "pointer", fontWeight: 700, marginLeft: 4 }}>
              ✓ Mark {selected.size} done
            </button>
          )}
          {/* Collaboration filter */}
          <select value={colabFilter} onChange={e => setColabFilter(e.target.value)}
            style={{ fontSize: 11, padding: "4px 8px", border: `1px solid ${B.border}`, borderRadius: 6, fontFamily: "inherit", color: colabFilter !== "All" ? B.blue : B.muted }}>
            <option value="All">All members</option>
            {MEMBERS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {/* View switcher */}
          {[["list","☰ List"], ["kanban","⬛ Board"], ["gantt","📅 Gantt"], ["calendar","🗓 Calendar"]].map(([v, lbl]) => (
            <button key={v} onClick={() => setTaskView(v)}
              style={{ padding: "5px 12px", fontSize: 11, border: `1px solid ${taskView === v ? B.blue : B.border}`, background: taskView === v ? B.blue + "18" : B.white, color: taskView === v ? B.blue : B.muted, borderRadius: 6, cursor: "pointer", fontWeight: taskView === v ? 700 : 400 }}>
              {lbl}
            </button>
          ))}
          <button onClick={() => setTemplateModal(true)} style={{ padding: "5px 10px", fontSize: 11, border: `1px solid ${B.border}`, background: B.white, color: B.muted, borderRadius: 6, cursor: "pointer" }}>📋 Template</button>
          <button onClick={() => setModal(true)} style={{ padding: "6px 14px", background: B.blue, color: "#fff", border: "none", borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>+ Add Task</button>
        </div>
      </div>

      {/* Kanban view */}
      {taskView === "kanban" && (
        <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8 }}>
          {["Pending","In Progress","In Review","Done","Blocked"].map(s => (
            <KanbanCol key={s} status={s}
              tasks={rows.filter(t => t.status === s)}
              onDragStart={id => { dragRef.current = id; }}
              onDrop={handleKanbanDrop}
              onEdit={openDetail} />
          ))}
        </div>
      )}

      {/* Gantt view */}
      {taskView === "gantt" && (
        <SectionCard title={`Gantt — ${rows.length} tasks`}>
          <GanttView tasks={rows} />
        </SectionCard>
      )}

      {/* Calendar view */}
      {taskView === "calendar" && (
        <SectionCard title="Calendar">
          <CalendarView
            tasks={rows}
            onOpenDetail={openDetail}
            onQuickAdd={(title, due) => {
              setData({ ...data, tasks: [...data.tasks, { id: nextId("T"), title, assigned: "", reviewAssignee: "", team: [], priority: "Medium", status: "Pending", due, start: "", ref: "", progress: 0, risk: "Low", subtasks: [], dependsOn: [], recurring: null, milestone: false, notes: "", comments: [], attachments: [], activityLog: [], bottleneck: false, approvalStatus: null }] });
            }}
          />
        </SectionCard>
      )}

      {/* List view */}
      {taskView === "list" && (
        <SectionCard title={`Tasks — ${rows.length} records`}>
          {viewMode === "excel"
            ? <><div className="excel-mobile-warning"><span style={{fontSize:24}}>🖥️</span><span>Excel view is only available on desktop</span></div><div className="excel-table-wrap" style={{ maxHeight: "calc(100vh - 280px)", display: "flex", flexDirection: "column", overflow: "hidden" }}><ExcelTable cols={cols} rows={rows} onChange={handleChange} onDelete={handleDelete} /></div></>
            : <>
                <NTable cols={cols} rows={rows} onRowClick={openDetail} />
                <div style={{ display: "flex", gap: 8, padding: "10px 14px", borderTop: `1px solid ${B.border}`, background: B.light + "80" }}>
                  <input value={quickTitle} onChange={e => setQuickTitle(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleQuickAdd()}
                    placeholder="Quick add task… press Enter"
                    style={{ flex: 1, border: `1px solid ${B.border}`, borderRadius: 6, padding: "6px 10px", fontSize: 12, fontFamily: "inherit", outline: "none", background: "#fff" }} />
                  <button onClick={handleQuickAdd} style={{ padding: "6px 12px", background: B.blue, color: "#fff", border: "none", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Add</button>
                </div>
              </>}
        </SectionCard>
      )}

      {/* Private Notes — collapsible dropdown */}
      <div style={{ border: `1px solid ${B.border}`, borderRadius: 10, overflow: "hidden", background: "#fff" }}>
        <button onClick={() => setNotesOpen(o => !o)}
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 16px", background: notesOpen ? B.light : "#fff", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
          <span style={{ fontWeight: 700, fontSize: 13, color: B.text }}>🔒 Private Notes</span>
          <span style={{ fontSize: 14, color: B.muted, display: "inline-block", transform: notesOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>▾</span>
        </button>
        {notesOpen && (
          <div style={{ borderTop: `1px solid ${B.border}` }}>
            <PrivateNotes members={MEMBERS} />
          </div>
        )}
      </div>

      {/* Template modal */}
      {templateModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 10, padding: 24, minWidth: 320, boxShadow: "0 16px 48px rgba(0,0,0,0.2)" }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>📋 Task Templates</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {TEMPLATES.map(t => (
                <button key={t.label} onClick={() => { handleAdd(t.vals); setTemplateModal(false); }}
                  style={{ padding: "10px 14px", border: `1px solid ${B.border}`, borderRadius: 7, background: B.light, cursor: "pointer", textAlign: "left", fontSize: 12, fontWeight: 600, color: B.text }}>
                  {t.label}
                  <div style={{ fontSize: 10, color: B.muted, fontWeight: 400, marginTop: 2 }}>Priority: {t.vals.priority} · {t.vals.recurring ? `Recurring ${t.vals.recurring}` : "One-time"}{t.vals.milestone ? " · Milestone" : ""}</div>
                </button>
              ))}
            </div>
            <button onClick={() => setTemplateModal(false)} style={{ marginTop: 12, width: "100%", padding: "7px", border: `1px solid ${B.border}`, borderRadius: 6, background: "#fff", cursor: "pointer", fontSize: 12 }}>Cancel</button>
          </div>
        </div>
      )}

      {modal && <FormModal title="Add Task" fields={FIELDS} onSave={handleAdd} onClose={() => setModal(false)} />}

      {/* Task detail side panel */}
      {detailTask && (
        <TaskDetailPanel
          task={detailTask.task}
          taskIndex={detailTask.index}
          allTasks={data.tasks}
          onClose={() => setDetailTask(null)}
          onUpdate={handleDetailUpdate}
          onAddComment={handleAddComment}
          onToggleSubtask={handleToggleSubtask}
          onSetApproval={handleSetApproval}
          currentUser="You"
        />
      )}
    </div>
  );
};

export default TasksTab;
