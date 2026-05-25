import { B } from "../constants";
import { aed } from "../helpers";

function exportCSV(title, metrics) {
  const rows = [["Metric","Value"], ...metrics];
  const csv = rows.map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = `${title.replace(/\s/g,"_")}.csv`; a.click();
  URL.revokeObjectURL(url);
}

const ReportsTab = ({ data }) => {
  const refreshedAt = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const totalRevenue = data.accounting.reduce((s, i) => s + i.paid, 0);
  const outstanding = data.accounting.reduce((s, i) => s + (i.amount - i.paid), 0);
  const wonValue = data.leads.filter((l) => l.status === "Won").reduce((s, l) => s + l.value, 0);

  const reports = [
    { title: "Revenue Summary", desc: "Total collected, outstanding, and invoiced amounts.", icon: "◆", color: B.blue, metrics: [["Total Invoiced", aed(totalRevenue + outstanding)], ["Collected", aed(totalRevenue)], ["Outstanding", aed(outstanding)]] },
    { title: "Lead Performance", desc: "Pipeline conversion and lead source analysis.", icon: "▲", color: B.green, metrics: [["Total Leads", data.leads.length], ["Won", data.leads.filter((l) => l.status === "Won").length], ["Won Value", aed(wonValue)]] },
    { title: "Client Health", desc: "Active, pending, and expired client statuses.", icon: "⬡", color: B.accent, metrics: [["Active", data.clients.filter((c) => c.status === "Active").length], ["Pending", data.clients.filter((c) => c.status === "Pending").length], ["Expired", data.clients.filter((c) => c.status === "Expired").length]] },
    { title: "Task Report", desc: "Completion rate and pending task breakdown.", icon: "◈", color: B.yellow, metrics: [["Total", data.tasks.length], ["Done", data.tasks.filter((t) => t.status === "Done").length], ["Pending", data.tasks.filter((t) => t.status === "Pending").length]] },
    { title: "Inventory Report", desc: "Stock levels and reorder alerts.", icon: "▤", color: B.orange, metrics: [["Total Items", data.inventory.length], ["Low Stock", data.inventory.filter((i) => i.status === "Low Stock").length], ["Critical", data.inventory.filter((i) => i.status === "Critical").length]] },
    { title: "Supplier Summary", desc: "Active suppliers and outstanding payables.", icon: "▥", color: "#7C3AED", metrics: [["Total", data.suppliers.length], ["Active", data.suppliers.filter((s) => s.status === "Active").length], ["Payable", aed(data.suppliers.reduce((s, x) => s + x.balance, 0))]] },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: B.muted }}>↺ Data as of {refreshedAt}</span>
      </div>
      <div className="reports-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
        {reports.map((r) => (
          <div key={r.title} style={{ background: B.white, border: `1px solid ${B.border}`, borderRadius: 8, padding: 16, borderTop: `3px solid ${r.color}` }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 16, color: r.color, flexShrink: 0 }}>{r.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{r.title}</div>
                <div style={{ fontSize: 11, color: B.muted }}>{r.desc}</div>
              </div>
              <button onClick={() => exportCSV(r.title, r.metrics)} title="Export CSV"
                style={{ padding: "3px 8px", fontSize: 10, fontWeight: 700, background: B.light, border: `1px solid ${B.border}`, borderRadius: 4, cursor: "pointer", color: B.muted, flexShrink: 0 }}>
                ↓ CSV
              </button>
            </div>
            <div style={{ borderTop: `1px solid ${B.border}`, paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              {r.metrics.map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span style={{ color: B.muted }}>{k}</span>
                  <span style={{ fontWeight: 700, color: B.text }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ReportsTab;
