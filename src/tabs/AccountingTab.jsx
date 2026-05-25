import { useState } from "react";
import { B } from "../constants";
import { aed, filterSearch, nextId } from "../helpers";
import { useAppData } from "../context/AppContext";
import {
  getTotalInvoiced,
  getTotalCollected,
  getTotalOutstanding,
  getCollectionRate,
  getOverdueInvoices,
  calcVAT,
  amountWithVAT,
  applyPartialPayment,
  calcOverduePenalty,
  createCreditNote,
  createDebitNote,
  generateNextRecurring,
} from "../services/accountingEngine";
import Badge from "../components/Badge";
import StatCard from "../components/StatCard";
import SectionCard from "../components/SectionCard";
import NTable from "../components/NTable";
import ExcelTable from "../components/ExcelTable";
import FormModal from "../components/FormModal";

const FIELDS = [
  { key: "client", label: "Client Name", placeholder: "Client or Company" },
  { key: "desc", label: "Description", placeholder: "Service description" },
  { key: "amount", label: "Amount (AED)", type: "number", placeholder: "0" },
  { key: "vatRate", label: "VAT %", type: "number", placeholder: "5", default: "5" },
  { key: "paid", label: "Amount Paid (AED)", type: "number", placeholder: "0", default: "0" },
  { key: "status", label: "Status", type: "select", options: ["Unpaid", "Partial", "Paid", "Overdue"] },
  { key: "date", label: "Invoice Date", type: "date" },
  { key: "due", label: "Due Date", type: "date" },
  {
    key: "recurringInterval",
    label: "Recurring",
    type: "select",
    options: ["None", "monthly", "quarterly", "yearly"],
    default: "None",
  },
];

const PAYMENT_FIELDS = [
  { key: "payment", label: "Payment Amount (AED)", type: "number", placeholder: "0" },
];

const NOTE_FIELDS = [
  { key: "noteAmount", label: "Amount (AED)", type: "number", placeholder: "0" },
  { key: "reason", label: "Reason", placeholder: "Reason for note" },
];

export default function AccountingTab({ viewMode, search }) {
  const { data, setData } = useAppData();
  const [modal, setModal] = useState(false);
  const [paymentModal, setPaymentModal] = useState(null); // invoice index
  const [noteModal, setNoteModal] = useState(null); // { index, type: "credit"|"debit" }
  const [showOverdueOnly, setShowOverdueOnly] = useState(false);

  const invoices = data.accounting;
  const total = getTotalInvoiced(invoices);
  const collected = getTotalCollected(invoices);
  const outstanding = getTotalOutstanding(invoices);
  const collectionRate = getCollectionRate(invoices);
  const overdueList = getOverdueInvoices(invoices);

  let rows = showOverdueOnly ? overdueList : invoices;
  rows = filterSearch(rows, search, ["id", "client", "desc", "status"]);

  const cols = [
    { key: "id", label: "Invoice #", width: 90 },
    { key: "client", label: "Client", width: 180 },
    { key: "desc", label: "Description", width: 200 },
    {
      key: "amount", label: "Amount (excl VAT)", width: 130,
      render: (v) => aed(v), xlRender: (v) => aed(v),
    },
    {
      key: "vatRate", label: "VAT %", width: 70,
      render: (v) => `${v ?? 5}%`,
    },
    {
      key: "amountWithVAT", label: "Total incl VAT", width: 130,
      render: (_, r) => <span style={{ fontWeight: 600 }}>{aed(amountWithVAT(r.amount, r.vatRate ?? 5))}</span>,
      xlRender: (_, r) => aed(amountWithVAT(r.amount, r.vatRate ?? 5)),
    },
    {
      key: "paid", label: "Paid", width: 110,
      render: (v) => <span style={{ color: B.green, fontWeight: 500 }}>{aed(v)}</span>,
      xlRender: (v) => aed(v),
    },
    {
      key: "balance", label: "Balance", width: 110,
      render: (_, r) => {
        const bal = amountWithVAT(r.amount, r.vatRate ?? 5) - r.paid;
        return <span style={{ color: bal > 0 ? B.red : B.green, fontWeight: 500 }}>{aed(bal)}</span>;
      },
      xlRender: (_, r) => aed(amountWithVAT(r.amount, r.vatRate ?? 5) - r.paid),
    },
    {
      key: "penalty", label: "Penalty", width: 90,
      render: (_, r) => {
        const p = calcOverduePenalty(r);
        return p > 0 ? <span style={{ color: B.orange, fontWeight: 500 }}>{aed(p)}</span> : <span style={{ color: B.muted }}>—</span>;
      },
      xlRender: (_, r) => aed(calcOverduePenalty(r)),
    },
    { key: "status", label: "Status", width: 100, render: (v) => <Badge label={v} /> },
    {
      key: "recurring", label: "Recurring", width: 90,
      render: (_, r) => r.recurringInterval && r.recurringInterval !== "None"
        ? <Badge label={r.recurringInterval} />
        : <span style={{ color: B.muted }}>—</span>,
    },
    { key: "date", label: "Invoice Date", width: 110 },
    { key: "due", label: "Due Date", width: 100 },
    {
      key: "actions", label: "Actions", width: 180,
      render: (_, r, ri) => (
        <div style={{ display: "flex", gap: 4 }}>
          <ActionBtn label="Pay" color={B.green} onClick={() => setPaymentModal(ri)} />
          <ActionBtn label="CR" color={B.blue} onClick={() => setNoteModal({ index: ri, type: "credit" })} title="Credit Note" />
          <ActionBtn label="DR" color={B.orange} onClick={() => setNoteModal({ index: ri, type: "debit" })} title="Debit Note" />
          {r.recurringInterval && r.recurringInterval !== "None" && (
            <ActionBtn label="↻" color={B.accent} onClick={() => handleGenerateRecurring(ri)} title="Generate next invoice" />
          )}
        </div>
      ),
    },
  ];

  const handleChange = (ri, key, val) => {
    const updated = [...data.accounting];
    updated[ri] = { ...updated[ri], [key]: isNaN(val) || val === "" ? val : Number(val) };
    setData({ ...data, accounting: updated });
  };

  const handleDelete = (ri) => {
    const updated = [...data.accounting];
    updated.splice(ri, 1);
    setData({ ...data, accounting: updated });
  };

  const handleAdd = (vals) => {
    const amt = Number(vals.amount) || 0;
    const paid = Number(vals.paid) || 0;
    const vatRate = Number(vals.vatRate) || 5;
    const recurring = vals.recurringInterval !== "None" ? vals.recurringInterval : undefined;
    setData({
      ...data,
      accounting: [
        ...data.accounting,
        {
          id: nextId("INV"),
          ...vals,
          amount: amt,
          paid,
          vatRate,
          recurringInterval: recurring,
          status: paid === 0 ? "Unpaid" : paid >= amountWithVAT(amt, vatRate) ? "Paid" : "Partial",
        },
      ],
    });
  };

  const handlePartialPayment = (vals) => {
    const payment = Number(vals.payment) || 0;
    const updated = [...data.accounting];
    updated[paymentModal] = applyPartialPayment(updated[paymentModal], payment);
    setData({ ...data, accounting: updated });
    setPaymentModal(null);
  };

  const handleNote = (vals) => {
    const { index, type } = noteModal;
    const invoice = data.accounting[index];
    const noteAmt = Number(vals.noteAmount) || 0;
    const note =
      type === "credit"
        ? createCreditNote(invoice, noteAmt, vals.reason)
        : createDebitNote(invoice, noteAmt, vals.reason);
    setData({
      ...data,
      accounting: [...data.accounting, { id: nextId("NOTE"), ...note }],
    });
    setNoteModal(null);
  };

  const handleGenerateRecurring = (ri) => {
    const template = data.accounting[ri];
    const next = generateNextRecurring(template);
    setData({
      ...data,
      accounting: [...data.accounting, { id: nextId("INV"), ...next }],
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* KPI cards */}
      <div className="kpi-grid-5" style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12 }}>
        <StatCard label="Total Invoiced" value={aed(total)} color={B.blue} />
        <StatCard label="Collected" value={aed(collected)} color={B.green} />
        <StatCard label="Outstanding" value={aed(outstanding)} color={B.red} />
        <StatCard label="Collection Rate" value={`${collectionRate}%`} color={B.accent} />
        <StatCard
          label="Overdue"
          value={overdueList.length}
          color={overdueList.length > 0 ? B.orange : B.green}
          sub={overdueList.length > 0 ? "invoices past due" : "all on time"}
        />
      </div>

      {/* Aging buckets */}
      {overdueList.length > 0 && (() => {
        const now = new Date();
        const bucket = (days) => overdueList.filter(i => {
          const d = (now - new Date(i.due)) / 86_400_000;
          return days === "60+" ? d > 60 : days === "31-60" ? d > 30 && d <= 60 : d <= 30;
        });
        const b0 = bucket("0-30"), b1 = bucket("31-60"), b2 = bucket("60+");
        return (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {[["0–30 days", b0, B.yellow], ["31–60 days", b1, B.orange], ["60+ days", b2, B.red]].map(([label, items, color]) => (
              <div key={label} style={{ background: color + "0e", border: `1px solid ${color}30`, borderRadius: 8, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 10, color, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>{label} overdue</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: B.text, marginTop: 2 }}>{items.length} <span style={{ fontSize: 11, fontWeight: 400, color: B.muted }}>invoices</span></div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color }}>{aed(items.reduce((s, i) => s + (amountWithVAT(i.amount, i.vatRate ?? 5) - i.paid), 0))}</div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Toolbar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <FilterBtn active={!showOverdueOnly} label="All Invoices" onClick={() => setShowOverdueOnly(false)} />
          <FilterBtn
            active={showOverdueOnly}
            label={`Overdue (${overdueList.length})`}
            onClick={() => setShowOverdueOnly(true)}
            danger
          />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {overdueList.length > 0 && (
            <button onClick={() => {
              overdueList.forEach(inv => {
                const title = `Chase payment — ${inv.client} (${inv.id})`;
                const alreadyExists = (data.tasks || []).some(t => t.ref === inv.id && t.title.startsWith("Chase payment"));
                if (!alreadyExists) {
                  setData(d => ({ ...d, tasks: [...(d.tasks||[]), { id: `T-AUTO-${Date.now()}-${inv.id}`, title, assigned: "Alex Reyes", priority: "High", status: "Pending", due: new Date(Date.now() + 86_400_000).toISOString().slice(0,10), ref: inv.id }] }));
                }
              });
            }} style={{ padding: "6px 12px", background: B.orange + "18", color: B.orange, border: `1px solid ${B.orange}40`, borderRadius: 6, fontWeight: 700, fontSize: 11, cursor: "pointer" }}>
              ⚡ Push overdue → Tasks
            </button>
          )}
          <button
            onClick={() => setModal(true)}
            style={{ padding: "6px 14px", background: B.blue, color: "#fff", border: "none", borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: "pointer" }}
          >
            + Add Invoice
          </button>
        </div>
      </div>

      {/* Table */}
      <SectionCard title={`Invoices — ${rows.length} records`}>
        {viewMode === "excel"
          ? (
            <><div className="excel-mobile-warning"><span style={{fontSize:24}}>🖥️</span><span>Excel view is only available on desktop</span></div><div className="excel-table-wrap" style={{ maxHeight: "calc(100vh - 320px)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <ExcelTable cols={cols} rows={rows} onChange={handleChange} onDelete={handleDelete} />
            </div></>
          )
          : <NTable cols={cols} rows={rows} />}
      </SectionCard>

      {/* Modals */}
      {modal && <FormModal title="Add Invoice" fields={FIELDS} onSave={handleAdd} onClose={() => setModal(false)} />}
      {paymentModal !== null && (
        <FormModal
          title={`Record Payment — ${data.accounting[paymentModal]?.client}`}
          fields={PAYMENT_FIELDS}
          onSave={handlePartialPayment}
          onClose={() => setPaymentModal(null)}
        />
      )}
      {noteModal !== null && (
        <FormModal
          title={`${noteModal.type === "credit" ? "Credit" : "Debit"} Note — ${data.accounting[noteModal.index]?.client}`}
          fields={NOTE_FIELDS}
          onSave={handleNote}
          onClose={() => setNoteModal(null)}
        />
      )}
    </div>
  );
}

// ─── Small helpers ─────────────────────────────────────────────────────────────

function ActionBtn({ label, color, onClick, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: "2px 8px", fontSize: 10, fontWeight: 700,
        background: color + "18", color, border: `1px solid ${color}40`,
        borderRadius: 4, cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function FilterBtn({ active, label, onClick, danger }) {
  const color = danger ? B.red : B.blue;
  return (
    <button
      onClick={onClick}
      style={{
        padding: "4px 14px", borderRadius: 20, fontSize: 11,
        border: `1px solid ${active ? color : B.border}`,
        background: active ? color : B.white,
        color: active ? "#fff" : B.muted,
        cursor: "pointer", fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}
