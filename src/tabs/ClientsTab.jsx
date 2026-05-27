import { useState, useMemo } from "react";
import { B } from "../constants";
import { aed, filterSearch, nextId } from "../helpers";
import { useAppData } from "../context/AppContext";
import Badge from "../components/Badge";
import SectionCard from "../components/SectionCard";
import StatCard from "../components/StatCard";
import NTable from "../components/NTable";
import ExcelTable from "../components/ExcelTable";
import FormModal from "../components/FormModal";

const FIELDS = [
  { key: "name", label: "Company Name", placeholder: "Company LLC" },
  { key: "contact", label: "Contact Person" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone" },
  { key: "service", label: "Service", type: "select", options: ["Business License", "Employment Visa", "Business Setup", "Freezone License", "UAE Visa"] },
  { key: "licenseNumber", label: "License / Visa Number", placeholder: "Optional" },
  { key: "status", label: "Status", type: "select", options: ["Active", "Pending", "Expired"] },
  { key: "value", label: "Contract Value (AED)", type: "number" },
  { key: "renewal", label: "Renewal Date", type: "date" },
  { key: "progress", label: "Progress %", type: "number", placeholder: "0-100" },
  { key: "notes", label: "Notes", placeholder: "Internal notes" },
];

function getRenewalStatus(renewal) {
  if (!renewal) return null;
  const diff = (new Date(renewal) - new Date()) / 86_400_000;
  if (diff < 0) return { label: "Expired", color: B.red };
  if (diff <= 14) return { label: "Renew Now", color: B.red };
  if (diff <= 30) return { label: "Renewing Soon", color: B.orange };
  return { label: "Active", color: B.green };
}

export default function ClientsTab({ viewMode, search }) {
  const { data, setData } = useAppData();
  const [filter, setFilter] = useState("All");
  const [modal, setModal] = useState(false);
  const [editModal, setEditModal] = useState(null); // client object to edit
  const [profileId, setProfileId] = useState(null); // client id for profile view
  const statuses = ["All", "Active", "Pending", "Expired"];

  let rows = filter === "All" ? data.clients : data.clients.filter((c) => c.status === filter);
  rows = filterSearch(rows, search, ["name", "contact", "email", "phone", "service", "licenseNumber"]);

  const expiringCount = useMemo(() =>
    data.clients.filter((c) => {
      const s = getRenewalStatus(c.renewal);
      return s && (s.label === "Renewing Soon" || s.label === "Renew Now");
    }).length, [data.clients]);

  const cols = [
    { key: "id", label: "ID", width: 70 },
    {
      key: "name", label: "Company", width: 190,
      render: (v, r) => (
        <button onClick={() => setProfileId(r.id)} style={{ background: "none", border: "none", color: B.blue, fontWeight: 600, cursor: "pointer", fontSize: 12, textAlign: "left", padding: 0 }}>
          {v}
        </button>
      ),
    },
    { key: "contact", label: "Contact", width: 140 },
    { key: "service", label: "Service", width: 140 },
    { key: "licenseNumber", label: "License/Visa #", width: 130, render: (v) => v || <span style={{ color: B.muted }}>—</span> },
    { key: "status", label: "Status", width: 100, render: (v) => <Badge label={v} /> },
    { key: "value", label: "Value", width: 110, render: (v) => aed(v), xlRender: (v) => aed(v) },
    {
      key: "progress", label: "Progress", width: 140,
      render: (v) => (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ flex: 1, height: 6, background: B.light, borderRadius: 3 }}>
            <div style={{ height: "100%", width: `${v}%`, background: v === 100 ? B.green : B.blue, borderRadius: 3 }} />
          </div>
          <span style={{ fontSize: 11, color: B.muted }}>{v}%</span>
        </div>
      ),
      xlRender: (v) => `${v}%`,
    },
    {
      key: "renewal", label: "Renewal", width: 130,
      render: (v) => {
        const s = getRenewalStatus(v);
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 11 }}>{v || "—"}</span>
            {s && s.label !== "Active" && <span style={{ fontSize: 10, color: s.color, fontWeight: 600 }}>{s.label}</span>}
          </div>
        );
      },
    },
    { key: "email", label: "Email", width: 180 },
    { key: "phone", label: "Phone", width: 150 },
    {
      key: "_edit", label: "", width: 70,
      render: (_, r) => (
        <button onClick={() => setEditModal(r)}
          style={{ padding: "3px 10px", fontSize: 10, fontWeight: 700, background: B.blue + "12", color: B.blue, border: `1px solid ${B.blue}30`, borderRadius: 4, cursor: "pointer" }}>
          ✏ Edit
        </button>
      ),
    },
  ];

  const handleChange = (ri, key, val) => {
    const updated = [...data.clients];
    updated[ri] = { ...updated[ri], [key]: val };
    setData({ ...data, clients: updated });
  };

  const handleDelete = (ri) => {
    const updated = [...data.clients];
    updated.splice(ri, 1);
    setData({ ...data, clients: updated });
  };

  const handleAdd = (vals) => {
    setData({
      ...data,
      clients: [...data.clients, {
        id: nextId("C"),
        ...vals,
        value: Number(vals.value) || 0,
        progress: Number(vals.progress) || 0,
        started: new Date().toISOString().slice(0, 10),
      }],
    });
  };

  const handleEdit = (vals) => {
    const updated = data.clients.map(c =>
      c.id === editModal.id
        ? { ...c, ...vals, value: Number(vals.value) || 0, progress: Number(vals.progress) || 0 }
        : c
    );
    setData({ ...data, clients: updated });
    setEditModal(null);
  };

  const profileClient = profileId ? data.clients.find((c) => c.id === profileId) : null;
  const linkedInvoices = profileClient ? data.accounting.filter((i) => i.client === profileClient.name) : [];
  const linkedTasks = profileClient ? (data.tasks || []).filter((t) => t.clientId === profileClient.id || t.client === profileClient.name) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: viewMode === "excel" ? 0 : 12, height: "100%", minHeight: 0 }}>
      {/* Renewal alert banner */}
      {expiringCount > 0 && (
        <div style={{ background: B.orange + "15", border: `1px solid ${B.orange}40`, borderRadius: 8, padding: "8px 14px", fontSize: 12, color: B.orange, fontWeight: 600 }}>
          ⚠️ {expiringCount} client{expiringCount > 1 ? "s" : ""} with renewal due in the next 30 days
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {statuses.map((s) => (
            <button key={s} onClick={() => setFilter(s)} style={{
              padding: "4px 14px", borderRadius: 20, fontSize: 11,
              border: `1px solid ${filter === s ? B.blue : B.border}`,
              background: filter === s ? B.blue : B.white,
              color: filter === s ? "#fff" : B.muted,
              cursor: "pointer", fontWeight: filter === s ? 600 : 400,
            }}>{s}</button>
          ))}
        </div>
        <button onClick={() => setModal(true)} style={{ padding: "6px 14px", background: B.blue, color: "#fff", border: "none", borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>+ Add Client</button>
      </div>

      {/* Table */}
      <SectionCard title={`Ongoing Clients — ${rows.length} records`} style={viewMode === "excel" ? { flex: 1, minHeight: 0 } : {}}>
        {viewMode === "excel"
          ? <><div className="excel-mobile-warning"><span style={{fontSize:24}}>🖥️</span><span>Excel view is only available on desktop</span></div><div className="excel-table-wrap"><ExcelTable cols={cols} rows={rows} onChange={handleChange} onDelete={handleDelete} /></div></>
          : <NTable cols={cols} rows={rows} />}
      </SectionCard>

      {/* Client profile drawer */}
      {profileClient && (
        <ProfileDrawer
          client={profileClient}
          invoices={linkedInvoices}
          tasks={linkedTasks}
          onClose={() => setProfileId(null)}
        />
      )}

      {modal && <FormModal title="Add Client" fields={FIELDS} onSave={handleAdd} onClose={() => setModal(false)} />}
      {editModal && (
        <FormModal
          title={`Edit Client — ${editModal.name}`}
          fields={FIELDS}
          initialValues={editModal}
          onSave={handleEdit}
          onClose={() => setEditModal(null)}
        />
      )}
    </div>
  );
}

// ─── Profile Drawer ────────────────────────────────────────────────────────────

function ProfileDrawer({ client, invoices, tasks, onClose }) {
  const renewalStatus = getRenewalStatus(client.renewal);
  const totalBilled = invoices.reduce((s, i) => s + (i.amount ?? 0), 0);
  const totalPaid = invoices.reduce((s, i) => s + (i.paid ?? 0), 0);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200, display: "flex", justifyContent: "flex-end",
      background: "rgba(0,0,0,0.35)",
    }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 480, background: "#fff", height: "100%", overflow: "auto",
          boxShadow: "-4px 0 24px rgba(0,0,0,0.12)", padding: 28, display: "flex", flexDirection: "column", gap: 20,
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, marginBottom: 4 }}>{client.name}</div>
            <div style={{ fontSize: 12, color: B.muted }}>{client.contact} · {client.service}</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: B.muted }}>×</button>
        </div>

        {/* Status & renewal */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <InfoBlock label="Status"><Badge label={client.status} /></InfoBlock>
          <InfoBlock label="Renewal Date">
            <span style={{ fontWeight: 600, color: renewalStatus?.color ?? B.text }}>{client.renewal || "—"}</span>
            {renewalStatus && renewalStatus.label !== "Active" && (
              <span style={{ marginLeft: 8, fontSize: 11, color: renewalStatus.color, fontWeight: 600 }}>({renewalStatus.label})</span>
            )}
          </InfoBlock>
          <InfoBlock label="License / Visa #"><span style={{ fontWeight: 600 }}>{client.licenseNumber || "—"}</span></InfoBlock>
          <InfoBlock label="Contract Value"><span style={{ fontWeight: 700, color: B.blue }}>{aed(client.value)}</span></InfoBlock>
          <InfoBlock label="Email"><a href={`mailto:${client.email}`} style={{ color: B.blue, fontSize: 12 }}>{client.email}</a></InfoBlock>
          <InfoBlock label="Phone">{client.phone}</InfoBlock>
        </div>

        {/* Progress */}
        <div>
          <div style={{ fontSize: 11, color: B.muted, fontWeight: 600, marginBottom: 6 }}>PROGRESS</div>
          <div style={{ height: 8, background: B.light, borderRadius: 4 }}>
            <div style={{ height: "100%", width: `${client.progress}%`, background: client.progress === 100 ? B.green : B.blue, borderRadius: 4, transition: "width 0.4s" }} />
          </div>
          <div style={{ fontSize: 11, color: B.muted, marginTop: 4 }}>{client.progress}% complete</div>
        </div>

        {/* Financial summary */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <MiniStat label="Billed" value={aed(totalBilled)} color={B.blue} />
          <MiniStat label="Paid" value={aed(totalPaid)} color={B.green} />
          <MiniStat label="Outstanding" value={aed(totalBilled - totalPaid)} color={totalBilled - totalPaid > 0 ? B.red : B.green} />
        </div>

        {/* Linked invoices */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: B.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Invoices ({invoices.length})</div>
          {invoices.length === 0 ? (
            <div style={{ fontSize: 12, color: B.muted }}>No invoices linked</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {invoices.map((inv) => (
                <div key={inv.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: B.light, borderRadius: 8 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{inv.id}</div>
                    <div style={{ fontSize: 11, color: B.muted }}>{inv.desc}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{aed(inv.amount)}</div>
                    <Badge label={inv.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Linked tasks */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: B.muted, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Tasks ({tasks.length})</div>
          {tasks.length === 0 ? (
            <div style={{ fontSize: 12, color: B.muted }}>No tasks linked</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {tasks.map((task) => (
                <div key={task.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: B.light, borderRadius: 8 }}>
                  <span style={{ fontSize: 12 }}>{task.title}</span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Badge label={task.priority} />
                    <Badge label={task.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notes */}
        {client.notes && (
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: B.muted, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Notes</div>
            <div style={{ fontSize: 12, color: B.text, lineHeight: 1.6, background: B.light, borderRadius: 8, padding: "10px 12px" }}>{client.notes}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoBlock({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: B.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 12 }}>{children}</div>
    </div>
  );
}

function MiniStat({ label, value, color }) {
  return (
    <div style={{ background: B.light, borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
      <div style={{ fontSize: 14, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 10, color: B.muted, marginTop: 2 }}>{label}</div>
    </div>
  );
}
