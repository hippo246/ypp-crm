import { useState } from "react";
import { B } from "../constants";
import { filterSearch, nextId } from "../helpers";
import Badge from "../components/Badge";
import SectionCard from "../components/SectionCard";
import NTable from "../components/NTable";
import ExcelTable from "../components/ExcelTable";
import FormModal from "../components/FormModal";

const FIELDS = [
  { key: "title", label: "Task Title", placeholder: "Task description" },
  { key: "assigned", label: "Assigned To", type: "select", options: ["Anna", "Mark", "James", "Other"] },
  { key: "priority", label: "Priority", type: "select", options: ["High", "Medium", "Low"] },
  { key: "status", label: "Status", type: "select", options: ["Pending", "In Progress", "Done"] },
  { key: "due", label: "Due Date", type: "date" },
  { key: "ref", label: "Reference (optional)", placeholder: "L001, C001..." },
];

const TasksTab = ({ data, setData, viewMode, search }) => {
  const [filter, setFilter] = useState("All");
  const [modal, setModal] = useState(false);
  const statuses = ["All", "Pending", "In Progress", "Done"];

  let rows = filter === "All" ? data.tasks : data.tasks.filter((t) => t.status === filter);
  rows = filterSearch(rows, search, ["title", "assigned", "ref"]);

  const cols = [
    { key: "id", label: "ID", width: 70 },
    { key: "title", label: "Task", width: 280 },
    { key: "assigned", label: "Assigned", width: 100 },
    { key: "priority", label: "Priority", width: 90, render: (v) => <Badge label={v} /> },
    { key: "status", label: "Status", width: 110, render: (v) => <Badge label={v} /> },
    { key: "due", label: "Due Date", width: 110 },
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
    setData({ ...data, tasks: [...data.tasks, { id: nextId("T"), ...vals }] });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {statuses.map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              style={{ padding: "4px 14px", borderRadius: 20, fontSize: 11, border: `1px solid ${filter === s ? B.blue : B.border}`, background: filter === s ? B.blue : B.white, color: filter === s ? "#fff" : B.muted, cursor: "pointer", fontWeight: filter === s ? 600 : 400 }}>
              {s}
            </button>
          ))}
        </div>
        <button onClick={() => setModal(true)} style={{ padding: "6px 14px", background: B.blue, color: "#fff", border: "none", borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>+ Add Task</button>
      </div>

      <SectionCard title={`Tasks — ${rows.length} records`}>
        {viewMode === "excel"
          ? <><div className="excel-mobile-warning"><span style={{fontSize:24}}>🖥️</span><span>Excel view is only available on desktop</span></div><div className="excel-table-wrap" style={{ maxHeight: "calc(100vh - 280px)", display: "flex", flexDirection: "column", overflow: "hidden" }}><ExcelTable cols={cols} rows={rows} onChange={handleChange} onDelete={handleDelete} /></div></> 
          : <NTable cols={cols} rows={rows} />}
      </SectionCard>

      {modal && <FormModal title="Add Task" fields={FIELDS} onSave={handleAdd} onClose={() => setModal(false)} />}
    </div>
  );
};

export default TasksTab;
