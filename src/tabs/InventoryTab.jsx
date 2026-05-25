import { useState } from "react";
import { aed, filterSearch, nextId } from "../helpers";
import { B } from "../constants";
import Badge from "../components/Badge";
import SectionCard from "../components/SectionCard";
import NTable from "../components/NTable";
import ExcelTable from "../components/ExcelTable";
import FormModal from "../components/FormModal";

const FIELDS = [
  { key: "name", label: "Item Name" },
  { key: "category", label: "Category", type: "select", options: ["Forms", "Digital", "Supplies", "Equipment"] },
  { key: "qty", label: "Quantity", type: "number" },
  { key: "unit", label: "Unit", placeholder: "pcs, reams..." },
  { key: "reorder", label: "Reorder Point", type: "number" },
  { key: "cost", label: "Unit Cost (AED)", type: "number" },
  { key: "supplier", label: "Supplier ID", placeholder: "S001..." },
  { key: "status", label: "Status", type: "select", options: ["In Stock", "Low Stock", "Critical"] },
];

const InventoryTab = ({ data, setData, viewMode, search }) => {
  const [modal, setModal] = useState(false);
  let rows = filterSearch(data.inventory, search, ["id", "name", "category", "supplier", "status"]);

  const cols = [
    { key: "id", label: "ID", width: 70 },
    { key: "name", label: "Item Name", width: 220 },
    { key: "category", label: "Category", width: 120 },
    { key: "qty", label: "Qty", width: 80 },
    { key: "unit", label: "Unit", width: 80 },
    { key: "reorder", label: "Reorder Pt.", width: 100 },
    { key: "cost", label: "Unit Cost", width: 100, render: (v) => aed(v), xlRender: (v) => aed(v) },
    { key: "supplier", label: "Supplier", width: 90 },
    { key: "status", label: "Status", width: 110, render: (v) => <Badge label={v} /> },
  ];

  const handleChange = (ri, key, val) => {
    const updated = [...data.inventory];
    updated[ri] = { ...updated[ri], [key]: val };
    setData({ ...data, inventory: updated });
  };

  const handleDelete = (ri) => {
    const updated = [...data.inventory];
    updated.splice(ri, 1);
    setData({ ...data, inventory: updated });
  };

  const handleAdd = (vals) => {
    setData({ ...data, inventory: [...data.inventory, { id: nextId("I"), ...vals, qty: Number(vals.qty) || 0, reorder: Number(vals.reorder) || 0, cost: Number(vals.cost) || 0 }] });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={() => setModal(true)} style={{ padding: "6px 14px", background: B.blue, color: "#fff", border: "none", borderRadius: 6, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>+ Add Item</button>
      </div>
      <SectionCard title={`Inventory — ${rows.length} items`}>
        {viewMode === "excel"
          ? <><div className="excel-mobile-warning"><span style={{fontSize:24}}>🖥️</span><span>Excel view is only available on desktop</span></div><div className="excel-table-wrap" style={{ maxHeight: "calc(100vh - 280px)", display: "flex", flexDirection: "column", overflow: "hidden" }}><ExcelTable cols={cols} rows={rows} onChange={handleChange} onDelete={handleDelete} /></div></> 
          : <NTable cols={cols} rows={rows} />}
      </SectionCard>
      {modal && <FormModal title="Add Inventory Item" fields={FIELDS} onSave={handleAdd} onClose={() => setModal(false)} />}
    </div>
  );
};

export default InventoryTab;
