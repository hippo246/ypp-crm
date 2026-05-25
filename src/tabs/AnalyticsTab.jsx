import { useState } from "react";
import { B } from "../constants";
import { aed } from "../helpers";
import Badge from "../components/Badge";
import StatCard from "../components/StatCard";
import SectionCard from "../components/SectionCard";

function filterByRange(items, dateField, range) {
  if (range === "all") return items;
  const now = new Date();
  const cutoff = new Date();
  if (range === "thisMonth") { cutoff.setDate(1); }
  else if (range === "lastMonth") { cutoff.setMonth(cutoff.getMonth() - 1, 1); const end = new Date(now.getFullYear(), now.getMonth(), 1); return items.filter(i => { const d = new Date(i[dateField]); return d >= cutoff && d < end; }); }
  else if (range === "thisQuarter") { const q = Math.floor(now.getMonth() / 3); cutoff.setMonth(q * 3, 1); }
  return items.filter(i => new Date(i[dateField]) >= cutoff);
}

const AnalyticsTab = ({ data }) => {
  const [range, setRange] = useState("all");
  const ranges = [["all","All Time"],["thisMonth","This Month"],["lastMonth","Last Month"],["thisQuarter","This Quarter"]];

  const filteredLeads = filterByRange(data.leads, "date", range);
  const filteredClients = filterByRange(data.clients, "started", range);
  const filteredTasks = filterByRange(data.tasks, "due", range);

  const totalLeads = filteredLeads.length;
  const wonLeads = filteredLeads.filter((l) => l.status === "Won").length;
  const convRate = totalLeads ? Math.round((wonLeads / totalLeads) * 100) : 0;
  const avgDeal = Math.round(filteredLeads.filter((l) => l.status === "Won").reduce((s, l) => s + l.value, 0) / (wonLeads || 1));

  const serviceRevenue = {};
  filteredClients.forEach((c) => { serviceRevenue[c.service] = (serviceRevenue[c.service] || 0) + c.value; });

  const sourceLeads = {};
  filteredLeads.forEach((l) => { sourceLeads[l.source] = (sourceLeads[l.source] || 0) + 1; });

  const maxRev = Math.max(...Object.values(serviceRevenue), 1);
  const maxLeads = Math.max(...Object.values(sourceLeads), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Range filter */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: B.muted, fontWeight: 600 }}>Period:</span>
        {ranges.map(([val, lbl]) => (
          <button key={val} onClick={() => setRange(val)} style={{ padding: "4px 12px", borderRadius: 20, fontSize: 11, border: `1px solid ${range === val ? B.blue : B.border}`, background: range === val ? B.blue : B.white, color: range === val ? "#fff" : B.muted, cursor: "pointer", fontWeight: range === val ? 600 : 400 }}>{lbl}</button>
        ))}
      </div>

      <div className="kpi-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
        <StatCard label="Total Leads" value={totalLeads} color={B.blue} />
        <StatCard label="Conversion Rate" value={`${convRate}%`} color={B.green} />
        <StatCard label="Avg Deal Size" value={aed(avgDeal)} color={B.accent} />
        <StatCard label="Active Clients" value={filteredClients.filter((c) => c.status === "Active").length} color={B.yellow} />
      </div>
      <div className="analytics-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <SectionCard title="Revenue by Service">
          <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            {Object.entries(serviceRevenue).length === 0 && <div style={{ fontSize: 12, color: B.muted }}>No data for selected period</div>}
            {Object.entries(serviceRevenue).map(([service, rev]) => (
              <div key={service}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: B.muted }}>{service}</span>
                  <span style={{ fontWeight: 600 }}>{aed(rev)}</span>
                </div>
                <div style={{ height: 8, background: B.light, borderRadius: 4 }}>
                  <div style={{ height: "100%", width: `${(rev / maxRev) * 100}%`, background: `linear-gradient(90deg, ${B.blue}, ${B.accent})`, borderRadius: 4, transition: "width 0.5s" }} />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Leads by Source">
          <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            {Object.entries(sourceLeads).length === 0 && <div style={{ fontSize: 12, color: B.muted }}>No data for selected period</div>}
            {Object.entries(sourceLeads).map(([src, cnt]) => (
              <div key={src}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: B.muted }}>{src}</span>
                  <span style={{ fontWeight: 600 }}>{cnt} leads</span>
                </div>
                <div style={{ height: 8, background: B.light, borderRadius: 4 }}>
                  <div style={{ height: "100%", width: `${(cnt / maxLeads) * 100}%`, background: B.accent, borderRadius: 4, transition: "width 0.5s" }} />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Lead Status Breakdown">
          <div style={{ padding: "8px 0" }}>
            {["New", "Contacted", "Qualified", "Proposal", "Won", "Lost"].map((s) => {
              const cnt = filteredLeads.filter((l) => l.status === s).length;
              return (
                <div key={s} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 14px", borderBottom: `1px solid ${B.border}` }}>
                  <Badge label={s} />
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ height: 6, width: 80, background: B.light, borderRadius: 3 }}>
                      <div style={{ height: "100%", width: `${totalLeads ? (cnt / totalLeads) * 100 : 0}%`, background: B.blue, borderRadius: 3 }} />
                    </div>
                    <span style={{ fontWeight: 600, fontSize: 13, minWidth: 16, textAlign: "right" }}>{cnt}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
        <SectionCard title="Task Completion">
          <div style={{ padding: "14px" }}>
            {["Done", "In Progress", "Pending"].map((s) => {
              const cnt = filteredTasks.filter((t) => t.status === s).length;
              const pct = filteredTasks.length ? Math.round((cnt / filteredTasks.length) * 100) : 0;
              return (
                <div key={s} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                    <Badge label={s} />
                    <span style={{ fontWeight: 600 }}>{cnt} ({pct}%)</span>
                  </div>
                  <div style={{ height: 8, background: B.light, borderRadius: 4 }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: s === "Done" ? B.green : s === "In Progress" ? B.blue : B.yellow, borderRadius: 4, transition: "width 0.5s" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      </div>
    </div>
  );
};

export default AnalyticsTab;
