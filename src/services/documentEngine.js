/**
 * documentEngine.js
 * Branded PDF/HTML document templates with {{dynamic_fields}}.
 * Uses the browser's print API for PDF export.
 */

export const DOC_TYPES = {
  INVOICE:       "invoice",
  RECEIPT:       "receipt",
  CLIENT_LETTER: "client_letter",
  QUOTATION:     "quotation",
  RENEWAL_NOTICE:"renewal_notice",
};

export const DOC_LABELS = {
  invoice:        "Invoice",
  receipt:        "Receipt",
  client_letter:  "Client Letter",
  quotation:      "Quotation",
  renewal_notice: "Renewal Notice",
};

/** Replace {{field}} tokens in a template string */
export function interpolate(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return data[key] !== undefined ? data[key] : `{{${key}}}`;
  });
}

/** Build template data from an invoice + client records */
export function buildInvoiceData(invoice, client, companyInfo = {}) {
  const today = new Date().toLocaleDateString("en-AE", { day: "2-digit", month: "long", year: "numeric" });
  const balance = (invoice.amount ?? 0) - (invoice.paid ?? 0);
  return {
    invoice_number:  invoice.id ?? "",
    invoice_date:    invoice.date ?? today,
    due_date:        invoice.due ?? "",
    client_name:     invoice.client ?? client?.name ?? "",
    client_email:    client?.email ?? "",
    client_phone:    client?.phone ?? "",
    service_desc:    invoice.desc ?? "",
    amount:          `AED ${(invoice.amount ?? 0).toLocaleString()}`,
    paid:            `AED ${(invoice.paid ?? 0).toLocaleString()}`,
    balance:         `AED ${balance.toLocaleString()}`,
    status:          invoice.status ?? "",
    company_name:    companyInfo.name    ?? "YES PINOY PRO",
    company_address: companyInfo.address ?? "Dubai, UAE",
    company_email:   companyInfo.email   ?? "info@yespinoy.ae",
    company_phone:   companyInfo.phone   ?? "+971 4 000 0000",
    company_trn:     companyInfo.trn     ?? "TRN000000000",
    today,
  };
}

export function buildClientLetterData(client, companyInfo = {}) {
  const today = new Date().toLocaleDateString("en-AE", { day: "2-digit", month: "long", year: "numeric" });
  return {
    client_name:    client.name ?? "",
    contact_name:   client.contact ?? "",
    client_email:   client.email ?? "",
    service:        client.service ?? "",
    renewal_date:   client.renewal ?? "",
    company_name:   companyInfo.name    ?? "YES PINOY PRO",
    company_address:companyInfo.address ?? "Dubai, UAE",
    company_email:  companyInfo.email   ?? "info@yespinoy.ae",
    today,
  };
}

/** HTML templates */
const BRAND = {
  blue:   "#1D3557",
  yellow: "#FFB703",
  accent: "#457B9D",
  light:  "#F1F5F9",
  text:   "#1E293B",
  muted:  "#64748B",
  border: "#E2E8F0",
};

function baseStyles() {
  return `
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: ${BRAND.text}; background: #fff; }
    .page { max-width: 720px; margin: 0 auto; padding: 40px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 20px; border-bottom: 2px solid ${BRAND.yellow}; }
    .logo-block .company { font-size: 18px; font-weight: 800; color: ${BRAND.blue}; letter-spacing: 0.5px; }
    .logo-block .tagline { font-size: 11px; color: ${BRAND.muted}; margin-top: 2px; }
    .logo-block .details { font-size: 11px; color: ${BRAND.muted}; margin-top: 8px; line-height: 1.6; }
    .doc-title { font-size: 24px; font-weight: 700; color: ${BRAND.blue}; text-align: right; }
    .doc-meta { font-size: 11px; color: ${BRAND.muted}; text-align: right; margin-top: 4px; line-height: 1.7; }
    .section { margin-bottom: 24px; }
    .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: ${BRAND.muted}; margin-bottom: 8px; }
    .box { background: ${BRAND.light}; border-radius: 6px; padding: 12px 16px; font-size: 12px; line-height: 1.7; }
    table { width: 100%; border-collapse: collapse; }
    th { background: ${BRAND.blue}; color: #fff; padding: 8px 12px; font-size: 11px; font-weight: 600; text-align: left; }
    td { padding: 8px 12px; border-bottom: 1px solid ${BRAND.border}; font-size: 12px; }
    .totals-row td { font-weight: 600; background: ${BRAND.light}; }
    .balance-row td { font-weight: 700; color: ${BRAND.blue}; font-size: 13px; }
    .status-badge { display: inline-block; padding: 3px 10px; border-radius: 10px; font-size: 11px; font-weight: 600; }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid ${BRAND.border}; font-size: 11px; color: ${BRAND.muted}; text-align: center; line-height: 1.8; }
    @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
  `;
}

export function generateInvoiceHTML(data) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${data.invoice_number}</title><style>${baseStyles()}</style></head><body>
<div class="page">
  <div class="header">
    <div class="logo-block">
      <div class="company">🌞 ${data.company_name}</div>
      <div class="tagline">Business CRM · Dubai, UAE</div>
      <div class="details">
        ${data.company_address}<br>
        ${data.company_email}<br>
        ${data.company_phone}<br>
        TRN: ${data.company_trn}
      </div>
    </div>
    <div>
      <div class="doc-title">INVOICE</div>
      <div class="doc-meta">
        <strong>${data.invoice_number}</strong><br>
        Date: ${data.invoice_date}<br>
        Due: ${data.due_date}<br>
        <span class="status-badge" style="background:${data.status === 'Paid' ? '#F0FDF4' : '#FEF2F2'};color:${data.status === 'Paid' ? '#15803D' : '#B91C1C'}">${data.status}</span>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Bill to</div>
    <div class="box">
      <strong>${data.client_name}</strong><br>
      ${data.client_email}<br>
      ${data.client_phone}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Services</div>
    <table>
      <tr><th>Description</th><th style="text-align:right">Amount</th></tr>
      <tr><td>${data.service_desc}</td><td style="text-align:right">${data.amount}</td></tr>
      <tr class="totals-row"><td>Subtotal</td><td style="text-align:right">${data.amount}</td></tr>
      <tr class="totals-row"><td>Amount paid</td><td style="text-align:right;color:#15803D">(${data.paid})</td></tr>
      <tr class="balance-row"><td>Balance due</td><td style="text-align:right">${data.balance}</td></tr>
    </table>
  </div>

  <div class="footer">
    Thank you for your business · ${data.company_name} · ${data.company_email}<br>
    This document was generated on ${data.today}
  </div>
</div>
</body></html>`;
}

export function generateRenewalNoticeHTML(data) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Renewal Notice</title><style>${baseStyles()}</style></head><body>
<div class="page">
  <div class="header">
    <div class="logo-block">
      <div class="company">🌞 ${data.company_name}</div>
      <div class="tagline">Business CRM · Dubai, UAE</div>
      <div class="details">${data.company_address}<br>${data.company_email}</div>
    </div>
    <div>
      <div class="doc-title">RENEWAL NOTICE</div>
      <div class="doc-meta">Date: ${data.today}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Addressed to</div>
    <div class="box"><strong>${data.contact_name}</strong><br>${data.client_name}<br>${data.client_email}</div>
  </div>

  <div class="section">
    <p style="line-height:1.8">Dear <strong>${data.contact_name}</strong>,</p>
    <p style="line-height:1.8">We would like to remind you that your <strong>${data.service}</strong> with ${data.company_name} is due for renewal on <strong>${data.renewal_date}</strong>.</p>
    <p style="line-height:1.8">To ensure uninterrupted service and compliance, please contact us at your earliest convenience to proceed with the renewal process.</p>
    <p style="line-height:1.8">For any questions, please reach out to us at <strong>${data.company_email}</strong>.</p>
    <p style="line-height:1.8">Warm regards,<br><strong>${data.company_name}</strong></p>
  </div>

  <div class="footer">
    ${data.company_name} · ${data.company_address} · ${data.company_email}
  </div>
</div>
</body></html>`;
}

/** Open a print window for PDF export */
export function printDocument(html) {
  const win = window.open("", "_blank", "width=800,height=900");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 500);
}

/** Download as .html file (can be opened in browser → Save as PDF) */
export function downloadHTML(html, filename = "document.html") {
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
