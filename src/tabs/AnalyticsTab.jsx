import { B } from "../constants";
import { aed } from "../helpers";
import Badge from "../components/Badge";
import StatCard from "../components/StatCard";
import SectionCard from "../components/SectionCard";

const AnalyticsTab = ({ data }) => {
  const totalLeads = data.leads.length;
  const wonLeads = data.leads.filter((l) => l.status === "Won").length;
  const convRate = Math.round((wonLeads / totalLeads) * 100);
  const avgDeal = Math.round(data.leads.filter((l) => l.status === "Won").reduce((s, l) => s + l.value, 0) / (wonLeads || 1));

  const serviceRevenue = {};
  data.clients.forEach((c) => { serviceRevenue[c.service] = (serviceRevenue[c.service] || 0) + c.value; });

  const sourceLeads = {};
  data.leads.forEach((l) => { sourceLeads[l.source] = (sourceLeads[l.source] || 0) + 1; });

  const maxRev = Math.max(...Object.values(serviceRevenue));
  const maxLeads = Math.max(...Object.values(sourceLeads));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="kpi-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
        <StatCard label="Total Leads" value={totalLeads} color={B.blue} />
        <StatCard label="Conversion Rate" value={`${convRate}%`} color={B.green} />
        <StatCard label="Avg Deal Size" value={aed(avgDeal)} color={B.accent} />
        <StatCard label="Active Clients" value={data.clients.filter((c) => c.status === "Active").length} color={B.yellow} />
      </div>
      <div className="analytics-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <SectionCard title="Revenue by Service">
          <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            {Object.entries(serviceRevenue).map(([service, rev]) => (
              <div key={service}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: B.muted }}>{service}</span>
                  <span style={{ fontWeight: 600 }}>{aed(rev)}</span>
                </div>
                <div style={{ height: 8, background: B.light, borderRadius: 4 }}>
                  <div style={{ height: "100%", width: `${(rev / maxRev) * 100}%`, background: B.blue, borderRadius: 4 }} />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Leads by Source">
          <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
            {Object.entries(sourceLeads).map(([src, cnt]) => (
              <div key={src}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: B.muted }}>{src}</span>
                  <span style={{ fontWeight: 600 }}>{cnt} leads</span>
                </div>
                <div style={{ height: 8, background: B.light, borderRadius: 4 }}>
                  <div style={{ height: "100%", width: `${(cnt / maxLeads) * 100}%`, background: B.accent, borderRadius: 4 }} />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Lead Status Breakdown">
          <div style={{ padding: "8px 0" }}>
            {["New", "Contacted", "Qualified", "Proposal", "Won", "Lost"].map((s) => {
              const cnt = data.leads.filter((l) => l.status === s).length;
              return (
                <div key={s} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 14px", borderBottom: `1px solid ${B.border}` }}>
                  <Badge label={s} />
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ height: 6, width: 80, background: B.light, borderRadius: 3 }}>
                      <div style={{ height: "100%", width: `${(cnt / totalLeads) * 100}%`, background: B.blue, borderRadius: 3 }} />
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
              const cnt = data.tasks.filter((t) => t.status === s).length;
              const pct = Math.round((cnt / data.tasks.length) * 100);
              return (
                <div key={s} style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                    <Badge label={s} />
                    <span style={{ fontWeight: 600 }}>{cnt} ({pct}%)</span>
                  </div>
                  <div style={{ height: 8, background: B.light, borderRadius: 4 }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: s === "Done" ? B.green : s === "In Progress" ? B.blue : B.yellow, borderRadius: 4 }} />
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
