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
  let rows = filterSearch(data.suppliers, search, ["id", "name", "contact", "email", "category", "status"]);

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
    </div>
  );
};

export default SuppliersTab;
