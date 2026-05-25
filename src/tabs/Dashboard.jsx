import { useMemo } from "react";
import { B } from "../constants";
import { aed } from "../helpers";
import { useAppData } from "../context/AppContext";
import {
  getDashboardKPIs,
  getMoMRevenue,
  getMoMLeads,
  getPipelineStats,
  getRevenueByService,
} from "../services/analyticsEngine";
import { getOverdueInvoices } from "../services/accountingEngine";
import Avatar from "../components/Avatar";
import Badge from "../components/Badge";
import SectionCard from "../components/SectionCard";
import NTable from "../components/NTable";

export default function Dashboard() {
  const { data } = useAppData();
  const { accounting = [], clients = [], leads = [], tasks = [], inventory = [] } = data;

  const kpis = useMemo(() => getDashboardKPIs(data), [data]);
  const mom = useMemo(() => getMoMRevenue(accounting), [accounting]);
  const momLeads = useMemo(() => getMoMLeads(leads), [leads]);
  const pipelineStats = useMemo(() => getPipelineStats(leads), [leads]);
  const revenueByService = useMemo(() => getRevenueByService(accounting, clients), [accounting, clients]);
  const overdueList = useMemo(() => getOverdueInvoices(accounting), [accounting]);

  const recentLeads = useMemo(() =>
    [...leads].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).slice(0, 5),
    [leads]);
  const pendingTaskList = useMemo(() =>
    tasks.filter((t) => t.status !== "Done").slice(0, 5),
    [tasks]);

  const maxServiceVal = Math.max(...revenueByService.map((r) => r.val), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Overdue alert */}
      {overdueList.length > 0 && (
        <div style={{
          background: B.red + "12", border: `1px solid ${B.red}30`,
          borderRadius: 8, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10,
        }}>
          <span style={{ fontSize: 16 }}>⚠️</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: B.red }}>
            {overdueList.length} overdue invoice{overdueList.length > 1 ? "s" : ""} — total {aed(overdueList.reduce((s, i) => s + (i.amount - i.paid), 0))} outstanding
          </span>
        </div>
      )}

      {/* KPI cards — live data */}
      <div className="kpi-grid-5" style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12 }}>
        <StatKPI
          label="Total Revenue"
          value={`AED ${(kpis.totalRevenue / 1000).toFixed(1)}K`}
          sub={<Delta delta={mom.delta} />}
          color={B.blue}
        />
        <StatKPI
          label="Outstanding"
          value={`AED ${(kpis.outstanding / 1000).toFixed(1)}K`}
          sub={`${kpis.overdueCount} overdue`}
          color={B.red}
        />
        <StatKPI
          label="Active Clients"
          value={kpis.activeClients}
          sub={kpis.expiringClients > 0 ? `⚠ ${kpis.expiringClients} renewing soon` : "all good"}
          color={B.green}
        />
        <StatKPI
          label="Open Leads"
          value={kpis.openLeads}
          sub={<Delta delta={momLeads.delta} suffix=" vs last mo" />}
          color={B.yellow}
        />
        <StatKPI
          label="Pending Tasks"
          value={kpis.pendingTasks}
          sub={kpis.highPriorityTasks > 0 ? `${kpis.highPriorityTasks} high priority` : "no urgent items"}
          color={B.orange}
        />
      </div>

      {/* Secondary KPIs */}
      <div className="kpi-grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
        <StatKPI label="Collection Rate" value={`${kpis.collectionRate}%`} sub="of invoiced amount" color={B.accent} small />
        <StatKPI label="Conversion Rate" value={`${kpis.conversionRate}%`} sub="leads → won" color={B.green} small />
        <StatKPI label="Won Value (Total)" value={aed(kpis.wonValue)} sub="all time" color={B.blue} small />
      </div>

      {/* Mid row */}
      <div className="dash-mid-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <SectionCard title="Recent Leads">
          <NTable
            cols={[
              { key: "name", label: "Name", render: (v) => <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Avatar name={v} size={24} />{v}</div> },
              { key: "service", label: "Service" },
              { key: "status", label: "Status", render: (v) => <Badge label={v} /> },
              { key: "value", label: "Value", render: (v) => aed(v) },
            ]}
            rows={recentLeads}
          />
        </SectionCard>

        <SectionCard title="Pending Tasks">
          <div style={{ padding: "4px 0" }}>
            {pendingTaskList.map((t) => (
              <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderBottom: `1px solid ${B.border}` }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: t.priority === "High" ? B.red : t.priority === "Medium" ? B.yellow : B.green, flexShrink: 0 }} />
                <div style={{ flex: 1, fontSize: 12 }}>{t.title}</div>
                <Badge label={t.priority} />
                <span style={{ fontSize: 11, color: B.muted }}>{t.due}</span>
              </div>
            ))}
            {pendingTaskList.length === 0 && <div style={{ padding: "12px 14px", fontSize: 12, color: B.muted }}>All tasks complete 🎉</div>}
          </div>
        </SectionCard>
      </div>

      {/* Bottom row */}
      <div className="dash-bottom-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
        {/* Inventory alerts */}
        <SectionCard title="Inventory Alerts">
          {inventory.filter((i) => i.status !== "In Stock").length === 0 ? (
            <div style={{ padding: "12px 14px", fontSize: 12, color: B.muted }}>All items in stock</div>
          ) : (
            inventory.filter((i) => i.status !== "In Stock").map((i) => (
              <div key={i.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 14px", borderBottom: `1px solid ${B.border}` }}>
                <span style={{ fontSize: 12 }}>{i.name}</span>
                <Badge label={i.status} />
              </div>
            ))
          )}
        </SectionCard>

        {/* Revenue by service — LIVE */}
        <SectionCard title="Revenue by Service">
          {revenueByService.slice(0, 5).map((r) => (
            <div key={r.label} style={{ padding: "8px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                <span style={{ color: B.muted }}>{r.label}</span>
                <span style={{ fontWeight: 600 }}>{aed(r.val)}</span>
              </div>
              <div style={{ height: 6, background: B.light, borderRadius: 3 }}>
                <div style={{ height: "100%", width: `${(r.val / maxServiceVal) * 100}%`, background: B.blue, borderRadius: 3 }} />
              </div>
            </div>
          ))}
          {revenueByService.length === 0 && <div style={{ padding: "12px 14px", fontSize: 12, color: B.muted }}>No revenue data yet</div>}
        </SectionCard>

        {/* Lead pipeline — LIVE */}
        <SectionCard title="Lead Pipeline">
          {pipelineStats.map((s) => (
            <div key={s.stage} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 14px", borderBottom: `1px solid ${B.border}` }}>
              <Badge label={s.stage} />
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{s.count}</span>
                <span style={{ fontSize: 11, color: B.muted }}>{aed(s.value)}</span>
              </div>
            </div>
          ))}
        </SectionCard>
      </div>
    </div>
  );
}

// ─── Local components ──────────────────────────────────────────────────────────

function StatKPI({ label, value, sub, color, small }) {
  return (
    <div style={{
      background: "#fff",
      border: `1px solid ${B.border}`,
      borderRadius: 10,
      padding: small ? "12px 16px" : "16px 20px",
      borderTop: `3px solid ${color}`,
    }}>
      <div style={{ fontSize: 10, color: B.muted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: small ? 18 : 22, fontWeight: 800, color: B.text, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: B.muted, marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

function Delta({ delta, suffix = "" }) {
  if (delta === null) return <span style={{ color: B.muted }}>No prior month data</span>;
  const color = delta >= 0 ? B.green : B.red;
  const arrow = delta >= 0 ? "▲" : "▼";
  return (
    <span style={{ color, fontWeight: 600 }}>{arrow} {Math.abs(delta)}%{suffix}</span>
  );
}
