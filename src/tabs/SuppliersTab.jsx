import { useState } from "react";
import { aed, filterSearch, nextId } from "../helpers";
import { B } from "../constants";
import Badge from "../components/Badge";
import SectionCard from "../components/SectionCard";
import NTable from "../components/NTable";
import ExcelTable from "../components/ExcelTable";
import FormModal from "../components/FormModal";

const FIELDS = [
  { key: "name", label: "Supplier Name" },
  { key: "contact", label: "Contact Person" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone" },
  { key: "category", label: "Category", type: "select", options: ["Government Forms", "Digital Products", "Office Supplies", "Courier", "Other"] },
  { key: "status", label: "Status", type: "select", options: ["Active", "Inactive"] },
  { key: "terms", label: "Payment Terms", placeholder: "Net 30, COD..." },
  { key: "balance", label: "Balance (AED)", type: "number", default: "0" },
];

const SuppliersTab = ({ data, setData, viewMode, search }) => {
  const [modal, setModal] = useState(false);
  const [payModal, setPayModal] = useState(null); // supplier row index
  const [linkedModal, setLinkedModal] = useState(null); // supplier id
  let rows = filterSearch(data.suppliers, search, ["id", "name", "contact", "email", "category", "status"]);

  const handlePayBalance = (ri, amount) => {
    const updated = [...data.suppliers];
    const paid = Math.min(Number(amount) || 0, updated[ri].balance);
    updated[ri] = { ...updated[ri], balance: updated[ri].balance - paid };
    setData({ ...data, suppliers: updated });
    setPayModal(null);
  };

  const cols = [
    { key: "id", label: "ID", width: 70 },
    { key: "name", label: "Supplier", width: 200 },
    { key: "contact", label: "Contact", width: 140 },
    { key: "category", label: "Category", width: 140 },
    { key: "status", label: "Status", width: 100, render: (v) => <Badge label={v} /> },
    { key: "terms", label: "Terms", width: 90 },
    { key: "balance", label: "Balance", width: 110, render: (v) => aed(v), xlRender: (v) => aed(v) },
    { key: "email", label: "Email", width: 180 },
    { key: "phone", label: "Phone", width: 150 },
    {
      key: "_actions", label: "Actions", width: 150,
      render: (_, r, ri) => (
        <div style={{ display: "flex", gap: 4 }}>
          {r.balance > 0 && (
            <button onClick={() => setPayModal(ri)}
              style={{ padding: "3px 8px", fontSize: 10, fontWeight: 700, background: B.green + "15", color: B.green, border: `1px solid ${B.green}40`, borderRadius: 4, cursor: "pointer" }}>
              💳 Pay
            </button>
          )}
          <button onClick={() => setLinkedModal(r.id)}
            style={{ padding: "3px 8px", fontSize: 10, fontWeight: 700, background: B.blue + "12", color: B.blue, border: `1px solid ${B.blue}30`, borderRadius: 4, cursor: "pointer" }}>
            📦 Items
          </button>
        </div>
      ),
    },
  ];

  const handleChange = (ri, key, val) => {
    const updated = [...data.suppliers];
    updated[ri] = { ...updated[ri], [key]: val };
    setData({ ...data, suppliers: updated });
  };

  const handleDelete = (ri) => {
    const updated = [...data.suppliers];
    updated.splice(ri, 1);
    setData({ ...data, suppliers: updated });
  };

  const handleAdd = (vals) => {
    setData({ ...data, suppliers: [...data.suppliers, { id: nextId("S"), ...vals, balance: Number(vals.balance) || 0 }] });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={() => setModal(true)} style={{ padding: "6px 14px", background: B.blue, color: "#fff", border: "none", borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>+ Add Supplier</button>
      </div>
      <SectionCard title={`Suppliers — ${rows.length} records`}>
        {viewMode === "excel"
          ? <><div className="excel-mobile-warning"><span style={{fontSize:24}}>🖥️</span><span>Excel view is only available on desktop</span></div><div className="excel-table-wrap" style={{ maxHeight: "calc(100vh - 280px)", display: "flex", flexDirection: "column", overflow: "hidden" }}><ExcelTable cols={cols} rows={rows} onChange={handleChange} onDelete={handleDelete} /></div></> 
          : <NTable cols={cols} rows={rows} />}
      </SectionCard>
      {modal && <FormModal title="Add Supplier" fields={FIELDS} onSave={handleAdd} onClose={() => setModal(false)} />}

      {/* Pay balance modal */}
      {payModal !== null && (() => {
        const sup = rows[payModal] ?? data.suppliers[payModal];
        let amt = sup?.balance ?? 0;
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ background: "#fff", borderRadius: 10, padding: 24, width: 340, boxShadow: "0 16px 40px rgba(0,0,0,0.18)", display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Pay Balance — {sup?.name}</div>
              <div style={{ fontSize: 12, color: B.muted }}>Outstanding: <strong style={{ color: B.red }}>{aed(sup?.balance)}</strong></div>
              <input type="number" defaultValue={sup?.balance} id="pay-input"
                style={{ border: `1px solid ${B.border}`, borderRadius: 6, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", outline: "none" }}
                placeholder="Amount to pay (AED)" />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => setPayModal(null)} style={{ padding: "7px 14px", fontSize: 12, background: B.light, border: `1px solid ${B.border}`, borderRadius: 6, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                <button onClick={() => handlePayBalance(data.suppliers.findIndex(s => s.id === sup?.id), document.getElementById("pay-input")?.value)}
                  style={{ padding: "7px 14px", fontSize: 12, background: B.green, color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontWeight: 700 }}>
                  Confirm Payment
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Linked inventory modal */}
      {linkedModal && (() => {
        const sup = data.suppliers.find(s => s.id === linkedModal);
        const items = (data.inventory || []).filter(i => i.supplier === linkedModal || i.supplier === sup?.name || i.supplier === sup?.id);
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => setLinkedModal(null)}>
            <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 10, padding: 24, width: 460, maxHeight: "70vh", overflowY: "auto", boxShadow: "0 16px 40px rgba(0,0,0,0.18)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>📦 Inventory — {sup?.name}</div>
                <button onClick={() => setLinkedModal(null)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", color: B.muted }}>×</button>
              </div>
              {items.length === 0 ? (
                <div style={{ fontSize: 12, color: B.muted, padding: "12px 0" }}>No inventory items linked to this supplier.</div>
              ) : (
                items.map(item => (
                  <div key={item.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${B.border}` }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{item.name}</div>
                      <div style={{ fontSize: 11, color: B.muted }}>{item.category} · Qty: {item.qty}</div>
                    </div>
                    <Badge label={item.status} />
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default SuppliersTab;
