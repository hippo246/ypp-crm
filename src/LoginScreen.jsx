import { useState, useEffect, useRef, useCallback, useMemo } from "react";

/* ─────────────────────────────────────────────
   USERS  (no sensitive data shown on login page)
───────────────────────────────────────────────*/
const DEFAULT_USERS = [
  { id: 1, name: "Alex Reyes",    role: "Admin",      avatar: "AR", email: "alex@yespinoy.ae",  password: "admin123" },
  { id: 2, name: "Sarah Mendoza", role: "Sales",      avatar: "SM", email: "sarah@yespinoy.ae", password: "sales123" },
  { id: 3, name: "Mike Tan",      role: "Accountant", avatar: "MT", email: "mike@yespinoy.ae",  password: "acct123"  },
  { id: 4, name: "Lena Cruz",     role: "Operations", avatar: "LC", email: "lena@yespinoy.ae",  password: "ops123"   },
];

// Bug 3 fix: Proxy provides a safe fallback for any role not in the map
// (e.g. "Manager" added via Settings) so meta.border etc. never crash.
const _ROLE_META_BASE = {
  Admin:      { color: "#C084FC", bg: "rgba(192,132,252,0.12)", border: "rgba(192,132,252,0.22)", glyph: "⬡" },
  Sales:      { color: "#34D399", bg: "rgba(52,211,153,0.12)",  border: "rgba(52,211,153,0.22)",  glyph: "◈" },
  Accountant: { color: "#FBBF24", bg: "rgba(251,191,36,0.12)",  border: "rgba(251,191,36,0.22)",  glyph: "◇" },
  Operations: { color: "#60A5FA", bg: "rgba(96,165,250,0.12)",  border: "rgba(96,165,250,0.22)",  glyph: "○" },
  Manager:    { color: "#F87171", bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.22)", glyph: "◆" },
};
const _ROLE_META_DEFAULT = { color: "#94A3B8", bg: "rgba(148,163,184,0.12)", border: "rgba(148,163,184,0.22)", glyph: "●" };
const ROLE_META = new Proxy(_ROLE_META_BASE, {
  get: (target, key) => key in target ? target[key] : _ROLE_META_DEFAULT,
});

/* ─────────────────────────────────────────────
   FEATURE FLAGS (mock — wire to real APIs later)
───────────────────────────────────────────────*/
const PASSKEY_SUPPORTED = typeof window !== "undefined" &&
  window.PublicKeyCredential !== undefined;

/* ─────────────────────────────────────────────
   INLINE CSS
───────────────────────────────────────────────*/
// CSS is built dynamically inside the component using loginConfig colors
const BASE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html, body { height: 100%; }

/* ── ROOT ── */
.ls-root {
  min-height: 100vh;
  width: 100%;
  font-family: 'DM Sans', sans-serif;
  background: var(--bg);
  color: var(--text);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow-x: hidden;
  overflow-y: auto;
  position: relative;
  padding: 24px 16px;
}

/* ── CANVAS BACKGROUND ── */
.ls-canvas {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 0;
}

/* Gradient mesh */
.ls-mesh {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 60% 50% at 10% 90%,  color-mix(in srgb, var(--primary-mesh) 18%, transparent) 0%, transparent 60%),
    radial-gradient(ellipse 50% 40% at 90% 10%,  rgba(26,68,194,0.15) 0%, transparent 55%),
    radial-gradient(ellipse 40% 60% at 50% 50%,  rgba(7,9,15,0.8)      0%, transparent 100%);
}

/* Grid overlay */
.ls-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px);
  background-size: 52px 52px;
}

/* Noise grain */
.ls-grain {
  position: absolute;
  inset: -50%;
  width: 200%;
  height: 200%;
  opacity: 0.028;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  animation: grainDrift 8s steps(1) infinite;
}
@keyframes grainDrift {
  0%,100%{transform:translate(0,0)} 10%{transform:translate(-2%,-2%)} 20%{transform:translate(2%,-1%)}
  30%{transform:translate(-1%,2%)} 40%{transform:translate(2%,2%)} 50%{transform:translate(-2%,1%)}
  60%{transform:translate(1%,-2%)} 70%{transform:translate(-1%,1%)} 80%{transform:translate(2%,-2%)}
  90%{transform:translate(-2%,2%)}
}

/* Floating orbs */
.ls-orb {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  filter: blur(70px);
  animation: orbFloat 16s ease-in-out infinite;
}
.ls-orb-a { width:320px;height:320px;background:#C0281E;opacity:0.13;bottom:-100px;left:-80px;animation-delay:0s; }
.ls-orb-b { width:220px;height:220px;background:#1A44C2;opacity:0.10;top:40px;right:60px;animation-delay:-5s; }
.ls-orb-c { width:180px;height:180px;background:#F5C518;opacity:0.07;top:-40px;left:50%;animation-delay:-10s; }
@keyframes orbFloat {
  0%,100%{transform:translateY(0) scale(1)}
  33%{transform:translateY(-22px) scale(1.05)}
  66%{transform:translateY(12px) scale(0.96)}
}

/* ── CARD ── */
.ls-card {
  position: relative;
  z-index: 10;
  width: 100%;
  max-width: 440px;
  margin: 0 auto;
  padding: 40px 40px 32px;
  background: var(--card-bg, rgba(13,13,28,0.82));
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 24px;
  box-shadow:
    0 0 0 1px rgba(255,255,255,0.04) inset,
    0 32px 80px rgba(0,0,0,0.6),
    0 0 60px rgba(232,57,46,0.07);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  animation: cardIn 0.55s cubic-bezier(0.22,1,0.36,1) both;
}
@keyframes cardIn {
  from{opacity:0;transform:translateY(28px) scale(0.97)}
  to{opacity:1;transform:translateY(0) scale(1)}
}

/* ── LOGO ── */
.ls-logo {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 32px;
}
.ls-logo-mark {
  width: 40px; height: 40px;
  border-radius: 11px;
  background: linear-gradient(135deg, #E8392E 0%, #1A44C2 100%);
  display: flex; align-items: center; justify-content: center;
  font-size: 18px;
  box-shadow: 0 0 24px rgba(232,57,46,0.35), inset 0 1px 0 rgba(255,255,255,0.22);
  flex-shrink: 0;
}
.ls-logo-text { flex: 1; }
.ls-logo-name {
  font-family: 'Syne', sans-serif;
  font-size: 14px; font-weight: 700;
  letter-spacing: 0.06em; text-transform: uppercase;
  color: #fff; line-height: 1.1;
}
.ls-logo-sub { font-size: 10px; color: var(--dim); letter-spacing: 0.04em; margin-top: 2px; }

.ls-clock-pill {
  font-size: 10px; color: var(--dim);
  letter-spacing: 0.05em;
  background: rgba(255,255,255,0.04);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 4px 10px;
  white-space: nowrap;
  flex-shrink: 0;
}
.ls-clock-pill span { color: var(--muted); }

/* ── HEADING ── */
.ls-heading {
  margin-bottom: 26px;
}
.ls-title {
  font-family: 'Syne', sans-serif;
  font-size: 24px; font-weight: 800;
  color: #fff; letter-spacing: -0.02em;
  line-height: 1.15; margin-bottom: 5px;
}
.ls-sub { font-size: 13px; color: var(--muted); font-weight: 300; line-height: 1.5; }

/* ── FIELDS ── */
.ls-field { margin-bottom: 14px; }
.ls-label {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 8px;
}
.ls-label-text, label.ls-label-text {
  font-size: 10px; font-weight: 600;
  letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--dim);
  background: none; border: none; padding: 0;
}
.ls-forgot {
  font-size: 11px; color: rgba(232,57,46,0.55);
  background: none; border: none; cursor: pointer;
  font-family: 'DM Sans', sans-serif; padding: 0;
  transition: color 0.15s;
}
.ls-forgot:hover { color: #E8392E; }

.ls-input-wrap { position: relative; }
.ls-input-icon {
  position: absolute; left: 14px; top: 50%;
  transform: translateY(-50%);
  color: var(--dim); pointer-events: none;
  display: flex; align-items: center;
}
.ls-input {
  width: 100%;
  padding: 14px 16px 14px 44px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  font-size: 15px; color: #fff;
  font-family: 'DM Sans', sans-serif;
  outline: none;
  transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
  -webkit-appearance: none;
  caret-color: #E8392E;
}
.ls-input::placeholder { color: rgba(255,255,255,0.14); }
.ls-input:focus {
  border-color: rgba(232,57,46,0.5);
  background: rgba(255,255,255,0.06);
  box-shadow: 0 0 0 3px rgba(232,57,46,0.1);
}
.ls-input.error {
  border-color: rgba(251,113,133,0.5);
  box-shadow: 0 0 0 3px rgba(251,113,133,0.08);
  animation: shake 0.35s ease;
}
@keyframes shake {
  0%,100%{transform:translateX(0)}20%{transform:translateX(-5px)}
  40%{transform:translateX(5px)}60%{transform:translateX(-3px)}80%{transform:translateX(3px)}
}
.ls-input-pw { padding-right: 48px; }
.ls-pw-toggle {
  position: absolute; right: 13px; top: 50%; transform: translateY(-50%);
  background: none; border: none; cursor: pointer;
  color: var(--dim); padding: 4px;
  display: flex; align-items: center; border-radius: 6px;
  transition: color 0.15s;
}
.ls-pw-toggle:hover { color: var(--muted); }

/* Remember me row */
.ls-row { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.ls-checkbox {
  width: 16px; height: 16px;
  accent-color: #E8392E;
  cursor: pointer; flex-shrink: 0;
  border-radius: 4px;
}
.ls-checkbox-label {
  font-size: 12px; color: var(--muted);
  cursor: pointer; user-select: none;
  flex: 1;
}

/* ── ERROR ── */
.ls-error {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px;
  background: rgba(251,113,133,0.07);
  border: 1px solid rgba(251,113,133,0.18);
  border-radius: 9px;
  font-size: 12px; color: #FCA5A5;
  margin-bottom: 12px;
}

/* ── PRIMARY BUTTON ── */
.ls-btn {
  width: 100%;
  padding: 15px;
  background: linear-gradient(135deg, #E8392E 0%, #1A44C2 100%);
  border: none; border-radius: 13px;
  font-size: 14px; font-weight: 700; color: #fff;
  font-family: 'DM Sans', sans-serif;
  cursor: pointer; letter-spacing: 0.02em;
  transition: opacity 0.15s, transform 0.15s, box-shadow 0.2s;
  box-shadow: 0 4px 28px rgba(232,57,46,0.3), inset 0 1px 0 rgba(255,255,255,0.18);
  position: relative; overflow: hidden;
  display: flex; align-items: center; justify-content: center; gap: 8px;
}
.ls-btn::after {
  content:''; position:absolute; inset:0;
  background: linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 60%);
  pointer-events: none;
}
.ls-btn:hover:not(:disabled) {
  opacity: 0.9; transform: translateY(-1px);
  box-shadow: 0 8px 36px rgba(232,57,46,0.4), inset 0 1px 0 rgba(255,255,255,0.18);
}
.ls-btn:active:not(:disabled) { transform: translateY(0); }
.ls-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.ls-btn-inner { display:flex; align-items:center; gap:8px; }

/* ── ALT BUTTONS (passkey / SSO row) ── */
.ls-alt-row {
  display: flex; gap: 8px;
  margin-top: 10px;
}
.ls-alt-btn {
  flex: 1;
  display: flex; align-items: center; justify-content: center; gap: 7px;
  padding: 12px 10px;
  background: rgba(255,255,255,0.035);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 12px;
  font-size: 12px; font-weight: 500; color: var(--muted);
  font-family: 'DM Sans', sans-serif;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s, transform 0.12s;
}
.ls-alt-btn:hover {
  background: rgba(255,255,255,0.065);
  border-color: rgba(255,255,255,0.14);
  color: #fff;
  transform: translateY(-1px);
}
.ls-alt-btn:active { transform: translateY(0); }
.ls-alt-btn svg { flex-shrink:0; }

/* Passkey highlight */
.ls-alt-btn.passkey:hover {
  border-color: rgba(232,57,46,0.35);
  box-shadow: 0 0 16px rgba(232,57,46,0.1);
  color: #E8392E;
}

/* ── DIVIDER ── */
.ls-divider {
  display: flex; align-items: center; gap: 14px;
  margin: 22px 0 16px;
}
.ls-divider-line { flex:1; height:1px; background:var(--border); }
.ls-divider-text {
  font-size: 10px; color: var(--dim);
  white-space: nowrap; letter-spacing: 0.08em; text-transform: uppercase;
}

/* ── QUICK ACCESS ── */
.ls-quick-label {
  font-size: 10px; font-weight: 600;
  letter-spacing: 0.1em; text-transform: uppercase;
  color: var(--dim); margin-bottom: 10px;
}
.ls-quick-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 7px;
  margin-bottom: 0;
}
.ls-quick-btn {
  display: flex; align-items: center; gap: 9px;
  padding: 10px 12px;
  background: rgba(255,255,255,0.025);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 12px;
  cursor: pointer; font-family: 'DM Sans', sans-serif;
  text-align: left;
  transition: border-color 0.15s, background 0.15s, transform 0.12s, box-shadow 0.15s;
}
.ls-quick-btn:hover {
  background: var(--qbtn-bg, rgba(255,255,255,0.048));
  border-color: var(--qbtn-border, rgba(255,255,255,0.12));
  box-shadow: 0 4px 18px var(--qbtn-shadow, transparent);
  transform: translateY(-1px);
}
.ls-quick-btn:active { transform: translateY(0); }
.ls-avatar {
  width: 32px; height: 32px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; flex-shrink: 0;
  position: relative; transition: box-shadow 0.15s;
  letter-spacing: 0.01em;
}
.ls-avatar-badge {
  position: absolute; bottom:-3px; right:-3px;
  font-size: 8px; line-height: 1;
}
.ls-quick-name { font-size: 12px; font-weight: 500; color: rgba(255,255,255,0.82); line-height: 1.2; }
.ls-quick-role { font-size: 10px; margin-top: 2px; font-weight: 400; opacity: 0.8; }

/* ── FOOTER ── */
.ls-footer {
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 8px;
}
.ls-footer-text { font-size: 10px; color: var(--dim); letter-spacing: 0.03em; }
.ls-status-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: #34D399; box-shadow: 0 0 5px #34D399;
  display: inline-block; margin-right: 5px;
  animation: pulse 2.5s ease-in-out infinite;
}
@keyframes pulse {
  0%,100%{opacity:1;box-shadow:0 0 5px #34D399}
  50%{opacity:0.6;box-shadow:0 0 9px #34D399}
}
.ls-footer-links {
  display: flex; gap: 12px;
}
.ls-footer-link {
  font-size: 10px; color: var(--dim);
  text-decoration: none; letter-spacing: 0.03em;
  cursor: pointer; background: none; border: none;
  font-family: 'DM Sans', sans-serif; padding: 0;
  transition: color 0.15s;
}
.ls-footer-link:hover { color: var(--muted); }

/* ── SUCCESS ── */
.ls-success {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 16px; padding: 24px 0 20px;
  animation: fadeUp 0.4s ease;
  text-align: center;
}
.ls-success-ring {
  width: 68px; height: 68px; border-radius: 50%;
  background: rgba(52,211,153,0.12);
  border: 1px solid rgba(52,211,153,0.35);
  display: flex; align-items: center; justify-content: center;
  animation: pop 0.5s cubic-bezier(0.34,1.56,0.64,1) both;
}
@keyframes pop { from{transform:scale(0.3);opacity:0} to{transform:scale(1);opacity:1} }
.ls-success-wave {
  position: absolute;
  width: 68px; height: 68px; border-radius: 50%;
  border: 2px solid rgba(52,211,153,0.4);
  animation: wave 1.2s ease-out 0.3s both;
}
@keyframes wave { to{transform:scale(2.2);opacity:0} }
.ls-success-name { font-size: 17px; font-weight: 600; color: #fff; }
.ls-success-role { font-size: 12px; color: var(--muted); margin-top: 3px; }
.ls-success-bar {
  width: 180px; height: 3px;
  border-radius: 3px;
  background: rgba(255,255,255,0.08);
  overflow: hidden;
}
.ls-success-progress {
  height: 100%;
  background: linear-gradient(90deg, #34D399, #C084FC);
  border-radius: 3px;
  animation: progressFill 0.85s ease forwards;
}
@keyframes progressFill { from{width:0%} to{width:100%} }

/* ── PASSKEY MODAL ── */
.ls-pk-overlay {
  position: fixed; inset: 0; z-index: 200;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.7);
  backdrop-filter: blur(8px);
  animation: fadeIn 0.2s ease;
}
@keyframes fadeIn { from{opacity:0} to{opacity:1} }
.ls-pk-box {
  width: 320px; max-width: calc(100vw - 32px);
  background: rgba(16,16,30,0.98);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 20px;
  padding: 28px 24px 24px;
  text-align: center;
  box-shadow: 0 32px 80px rgba(0,0,0,0.7);
  animation: cardIn 0.3s cubic-bezier(0.22,1,0.36,1) both;
}
.ls-pk-icon {
  width: 60px; height: 60px; border-radius: 50%;
  background: rgba(232,57,46,0.1);
  border: 1px solid rgba(232,57,46,0.22);
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto 16px; font-size: 26px;
  animation: pkPulse 2s ease-in-out infinite;
}
@keyframes pkPulse {
  0%,100%{box-shadow:0 0 0 0 rgba(232,57,46,0.25)}
  50%{box-shadow:0 0 0 10px rgba(232,57,46,0)}
}
.ls-pk-title { font-family:'Syne',sans-serif; font-size:17px; font-weight:700; color:#fff; margin-bottom:8px; }
.ls-pk-sub { font-size:12px; color:var(--muted); line-height:1.6; margin-bottom:20px; }
.ls-pk-row { display:flex; gap:8px; }
.ls-pk-cancel {
  flex:1; padding:12px;
  background:rgba(255,255,255,0.04); border:1px solid var(--border);
  border-radius:11px; font-size:13px; color:var(--muted);
  font-family:'DM Sans',sans-serif; cursor:pointer;
  transition:background 0.15s;
}
.ls-pk-cancel:hover { background:rgba(255,255,255,0.08); }
.ls-pk-confirm {
  flex:1; padding:12px;
  background:linear-gradient(135deg,#E8392E,#1A44C2);
  border:none; border-radius:11px; font-size:13px; font-weight:600; color:#fff;
  font-family:'DM Sans',sans-serif; cursor:pointer;
  box-shadow:0 4px 20px rgba(232,57,46,0.28);
  transition:opacity 0.15s, transform 0.12s;
}
.ls-pk-confirm:hover { opacity:0.9; transform:translateY(-1px); }

/* ── BIOMETRIC HINT ── */
.ls-bio-hint {
  display:flex; align-items:center; gap:8px;
  padding:10px 14px; margin-top:10px;
  background:rgba(232,57,46,0.05);
  border:1px solid rgba(232,57,46,0.1);
  border-radius:10px; font-size:12px; color:rgba(232,57,46,0.7);
  cursor:pointer;
  transition:background 0.15s, border-color 0.15s;
}
.ls-bio-hint:hover {
  background:rgba(232,57,46,0.09);
  border-color:rgba(232,57,46,0.2);
  color:#E8392E;
}
.ls-bio-hint svg { flex-shrink:0; }

/* ── SPINNER ── */
.ls-spinner {
  width:16px; height:16px; border-radius:50%;
  border:2px solid rgba(255,255,255,0.25);
  border-top-color:#fff;
  animation:spin 0.5s linear infinite;
  flex-shrink:0;
}
@keyframes spin { to{transform:rotate(360deg)} }

/* ── ENTER ANIMATIONS ── */
.ls-enter { animation: fadeUp 0.4s ease both; }
.ls-e1 { animation-delay:0.05s; }
.ls-e2 { animation-delay:0.10s; }
.ls-e3 { animation-delay:0.15s; }
.ls-e4 { animation-delay:0.20s; }
.ls-e5 { animation-delay:0.25s; }
.ls-e6 { animation-delay:0.30s; }
@keyframes fadeUp {
  from{opacity:0;transform:translateY(12px)}
  to{opacity:1;transform:translateY(0)}
}

/* ── SECURITY BADGE ── */
.ls-secure-badge {
  display:inline-flex; align-items:center; gap:5px;
  background:rgba(52,211,153,0.06);
  border:1px solid rgba(52,211,153,0.14);
  border-radius:20px; padding:4px 10px;
  font-size:10px; color:rgba(52,211,153,0.65);
  letter-spacing:0.04em;
  margin-bottom: 20px;
}
.ls-secure-dot {
  width:5px;height:5px;border-radius:50%;
  background:#34D399;box-shadow:0 0 5px #34D399;
  animation:pulse 2.5s ease-in-out infinite;
}

/* ── TOAST INTERNAL ── */
.ls-toast {
  position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
  z-index: 999;
  background: rgba(20,20,36,0.98);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 12px;
  padding: 12px 18px;
  font-size: 13px; color: #fff;
  display: flex; align-items: center; gap: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  animation: toastIn 0.3s cubic-bezier(0.22,1,0.36,1) both;
  white-space: nowrap;
}
@keyframes toastIn {
  from{opacity:0;transform:translateX(-50%) translateY(16px)}
  to{opacity:1;transform:translateX(-50%) translateY(0)}
}

/* ── MOBILE RESPONSIVE ── */
@media (max-width: 500px) {
  .ls-card {
    max-width: 100%;
    min-height: 100svh;
    border-radius: 0;
    padding: 32px 24px 40px;
    display: flex; flex-direction: column;
    justify-content: center;
    box-shadow: none;
    border: none;
    background: rgba(7,7,15,0.97);
  }
  /* safe-area */
  .ls-card {
    padding-bottom: max(40px, calc(env(safe-area-inset-bottom) + 24px));
    padding-top: max(32px, calc(env(safe-area-inset-top) + 16px));
  }
  .ls-input { font-size: 16px !important; }
  .ls-title { font-size: 26px; }
  .ls-alt-row { flex-direction: column; }
  .ls-quick-grid { grid-template-columns: 1fr 1fr; }
  .ls-pk-overlay { align-items: flex-end; }
  .ls-pk-box {
    width: 100%; border-radius: 20px 20px 0 0;
    padding-bottom: max(28px, calc(env(safe-area-inset-bottom) + 20px));
  }
}
@media (min-width: 501px) and (max-width: 700px) {
  .ls-card {
    margin: 16px;
    max-width: calc(100% - 32px);
  }
}
@media (max-height: 680px) and (max-width: 500px) {
  .ls-logo { margin-bottom: 20px; }
  .ls-heading { margin-bottom: 18px; }
  .ls-secure-badge { margin-bottom: 14px; }
  .ls-field { margin-bottom: 10px; }
  .ls-divider { margin: 16px 0 12px; }
}
`;

/* ── SVG ICONS ── */
const IconMail = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
    <polyline points="22,6 12,13 2,6"/>
  </svg>
);
const IconLock = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0110 0v4"/>
  </svg>
);
const IconEyeOn = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);
const IconEyeOff = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);
const IconAlert = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="8" x2="12" y2="12"/>
    <line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>
);
const IconCheck = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const IconKey = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
  </svg>
);
const IconFingerprint = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 018.5 4.7"/>
    <path d="M5 19.5C5.5 18 6 15 6 12c0-3.3 2.7-6 6-6 1.8 0 3.4.8 4.5 2"/>
    <path d="M8 21c.3-1.2 1-5 1-7 0-1.7 1.3-3 3-3 1.4 0 2.7.9 3 2.3"/>
    <path d="M14 22c0-2 .5-4 1-6"/>
    <path d="M2 10a10 10 0 01.5-2.5"/>
    <path d="M20 13c0 5-2 7-2 7"/>
    <path d="M22 10c-.1-1-.5-2-1-3"/>
    <path d="M11 22c-.1-1.5.2-4 .5-6"/>
  </svg>
);
const IconGoogle = () => (
  <svg width="15" height="15" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);
const IconMicrosoft = () => (
  <svg width="15" height="15" viewBox="0 0 24 24">
    <rect x="1" y="1" width="10" height="10" fill="#F25022"/>
    <rect x="13" y="1" width="10" height="10" fill="#7FBA00"/>
    <rect x="1" y="13" width="10" height="10" fill="#00A4EF"/>
    <rect x="13" y="13" width="10" height="10" fill="#FFB900"/>
  </svg>
);
const IconShield = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
);

/* ── LIVE CLOCK ── */
function LiveClock({ timezone = "Asia/Dubai" }) {
  const [t, setT] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setT(new Date()), 1000); return () => clearInterval(id); }, []);

  // Resolve IANA timezone — fall back gracefully if an abbreviation like "GST" was passed
  const tz = (() => { try { Intl.DateTimeFormat(undefined, { timeZone: timezone }); return timezone; } catch { return undefined; } })();

  const datePart = t.toLocaleDateString(
    typeof navigator !== "undefined" ? navigator.language : "en",
    { weekday: "short", month: "short", day: "numeric", ...(tz ? { timeZone: tz } : {}) }
  );
  const timePart = t.toLocaleTimeString(
    typeof navigator !== "undefined" ? navigator.language : "en",
    { hour: "2-digit", minute: "2-digit", hour12: false, ...(tz ? { timeZone: tz } : {}) }
  );
  // Display the short timezone name when available
  const tzLabel = tz
    ? t.toLocaleTimeString("en", { timeZoneName: "short", timeZone: tz }).split(" ").pop()
    : timezone;

  return (
    <div className="ls-clock-pill">
      {datePart}{" · "}<span>{timePart} {tzLabel}</span>
    </div>
  );
}

/* ── PASSKEY MODAL ── */
function PasskeyModal({ onConfirm, onCancel }) {
  const boxRef = useRef(null);

  // Close on Escape; trap focus inside the modal
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") { onCancel(); return; }
      if (e.key === "Tab" && boxRef.current) {
        const focusable = boxRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const first = focusable[0];
        const last  = focusable[focusable.length - 1];
        if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    // Move focus into the modal on open
    boxRef.current?.querySelector("button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="ls-pk-overlay" onClick={onCancel} role="dialog" aria-modal="true" aria-labelledby="pk-title">
      <div className="ls-pk-box" ref={boxRef} onClick={e => e.stopPropagation()}>
        <div className="ls-pk-icon">🔑</div>
        <div className="ls-pk-title" id="pk-title">Sign in with Passkey</div>
        <div className="ls-pk-sub">
          Use your device's biometric (Face ID, Touch ID, or PIN) to authenticate securely — no password needed.
        </div>
        <div className="ls-pk-row">
          <button className="ls-pk-cancel" onClick={onCancel}>Cancel</button>
          <button className="ls-pk-confirm" onClick={onConfirm}>Authenticate</button>
        </div>
      </div>
    </div>
  );
}

/* ── MAIN ── */
export default function LoginScreen({ onLogin, loginConfig }) {
  const cfg = loginConfig || {};
  const USERS = cfg.users || DEFAULT_USERS;

  // Merge config CSS vars into the inline style sheet dynamically
  const primary   = cfg.primaryColor   || "#E8392E";
  const secondary = cfg.secondaryColor || "#1A44C2";
  const bgColor   = cfg.bgColor        || "#07090F";

  const css = useMemo(() => `
:root {
  --purple:        ${primary};
  --indigo:        ${secondary};
  --green:         #34D399;
  --amber:         #F5C518;
  --red:           #FB7185;
  --bg:            ${bgColor};
  --surface:       #0C0F1C;
  --surface2:      #111428;
  --border:        rgba(255,255,255,0.07);
  --text:          #F0F0FF;
  --muted:         rgba(240,240,255,0.38);
  --dim:           rgba(240,240,255,0.18);
  --card-bg:       ${cfg.cardBg || "rgba(13,13,28,0.82)"};
  --primary-mesh:  ${primary};
}
` + BASE_CSS, [primary, secondary, bgColor, cfg.cardBg]);

  const [email,       setEmail]       = useState("");
  const [password,    setPassword]    = useState("");
  const [showPw,      setShowPw]      = useState(false);
  const [remember,    setRemember]    = useState(false);
  const [error,       setError]       = useState("");
  const [loading,     setLoading]     = useState(false);
  const [success,     setSuccess]     = useState(null);
  const [showPasskey, setShowPasskey] = useState(false);
  const [toast,       setToast]       = useState(null);
  const [pkLoading,   setPkLoading]   = useState(false);
  const emailRef = useRef(null);
  const toastTimerRef = useRef(null);
  const pendingTimers = useRef(new Set());

  // Cancel all pending timers on unmount
  useEffect(() => () => {
    clearTimeout(toastTimerRef.current);
    pendingTimers.current.forEach(clearTimeout);
  }, []);

  // Wrapper so callers don't manage the set manually
  function safeTimeout(fn, ms) {
    const id = setTimeout(() => { pendingTimers.current.delete(id); fn(); }, ms);
    pendingTimers.current.add(id);
    return id;
  }

  // Restore remembered email
  useEffect(() => {
    try {
      const saved = localStorage.getItem("yp_email");
      if (saved) { setEmail(saved); setRemember(true); }
    } catch {}
    emailRef.current?.focus();
  }, []);

  const showToast = useCallback((msg, icon = "✓") => {
    clearTimeout(toastTimerRef.current);
    setToast({ msg, icon });
    toastTimerRef.current = setTimeout(() => setToast(null), 2800);
  }, []);

  function handleSubmit(e) {
    e?.preventDefault();
    setError(""); setLoading(true);
    safeTimeout(() => {
      const user = USERS.find(
        u => u.email.toLowerCase() === email.toLowerCase().trim() && u.password === password
      );
      if (user) {
        if (remember) { try { localStorage.setItem("yp_email", email); } catch {} }
        else { try { localStorage.removeItem("yp_email"); } catch {} }
        setSuccess(user);
        safeTimeout(() => onLogin(user), 1100);
      } else {
        setError("Invalid email or password. Check your credentials.");
        setLoading(false);
      }
    }, 750);
  }

  function handlePasskeyConfirm() {
    setShowPasskey(false);
    setPkLoading(true);
    safeTimeout(() => {
      // Mock: authenticate as first user
      const user = USERS[0];
      setPkLoading(false);
      setSuccess(user);
      safeTimeout(() => onLogin(user), 1100);
    }, 1400);
  }

  function handleSSO(provider) {
    showToast(`${provider} SSO is not configured for this environment`, "ℹ");
  }

  function quickLogin(user) {
    setSuccess(user);
    safeTimeout(() => onLogin(user), 1100);
  }

  return (
    <div className="ls-root">
      <style>{css}</style>

      {/* Background */}
      <div className="ls-canvas">
        <div className="ls-mesh" />
        {cfg.showGrid  !== false && <div className="ls-grid" />}
        {cfg.showGrain !== false && <div className="ls-grain" />}
        {cfg.showOrbs  !== false && <>
          <div className="ls-orb ls-orb-a" />
          <div className="ls-orb ls-orb-b" />
          <div className="ls-orb ls-orb-c" />
        </>}
      </div>

      {/* Passkey modal */}
      {showPasskey && (
        <PasskeyModal
          onConfirm={handlePasskeyConfirm}
          onCancel={() => setShowPasskey(false)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="ls-toast">
          <span>{toast.icon}</span> {toast.msg}
        </div>
      )}

      {/* Card */}
      <div className="ls-card">

        {/* Logo row */}
        <div className="ls-logo">
          <div className="ls-logo-mark" style={cfg.logoUrl ? { background: "transparent", boxShadow: "none" } : {}}>
            {cfg.logoUrl
              ? <img src={cfg.logoUrl} alt={cfg.appName || "logo"} style={{ width: "100%", height: "100%", objectFit: "contain", borderRadius: 8 }} />
              : (cfg.logoEmoji || "🌞")
            }
          </div>
          <div className="ls-logo-text">
            <div className="ls-logo-name">{cfg.appName || "Yes Pinoy Pro"}</div>
            <div className="ls-logo-sub">{cfg.appSubtitle || "Business CRM · Dubai, UAE"}</div>
          </div>
          {cfg.showClock !== false && <LiveClock timezone={cfg.clockTimezone || "GST"} />}
        </div>

        {success ? (
          /* ── SUCCESS STATE ── */
          <div className="ls-success">
            <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div className="ls-success-wave" />
              <div className="ls-success-ring"><IconCheck /></div>
            </div>
            <div>
              <div className="ls-success-name">Welcome back, {success.name.split(" ")[0]} 👋</div>
              <div className="ls-success-role">{success.role} · Redirecting…</div>
            </div>
            <div className="ls-success-bar">
              <div className="ls-success-progress" />
            </div>
          </div>
        ) : (
          <>
            {/* Heading */}
            <div className="ls-heading ls-enter">
              <div className="ls-title">{cfg.welcomeTitle || "Welcome back"}</div>
              <div className="ls-sub">{cfg.welcomeSub || "Sign in to your workspace to continue."}</div>
            </div>

            {/* Security badge */}
            {cfg.showSecureBadge !== false && <div className="ls-secure-badge ls-enter ls-e1">
              <div className="ls-secure-dot" />
              <IconShield />
              <span>{cfg.secureBadgeText || "Secure · End-to-end encrypted"}</span>
            </div>}

            {/* Form — wrapping gives Enter-key submit for free */}
            <form onSubmit={handleSubmit} noValidate>

            {/* Email field */}
            <div className="ls-field ls-enter ls-e2">
              <div className="ls-label">
                <label htmlFor="yp-email" className="ls-label-text">Email address</label>
              </div>
              <div className="ls-input-wrap">
                <span className="ls-input-icon"><IconMail /></span>
                <input
                  ref={emailRef}
                  id="yp-email"
                  className={`ls-input${error ? " error" : ""}`}
                  type="email" value={email}
                  onChange={e => { setEmail(e.target.value); setError(""); }}
                  placeholder={cfg.emailPlaceholder || "you@yespinoy.ae"}
                  required autoComplete="email" autoCapitalize="none"
                  inputMode="email"
                  aria-describedby={error ? "yp-error" : undefined}
                />
              </div>
            </div>

            {/* Password field */}
            <div className="ls-field ls-enter ls-e3">
              <div className="ls-label">
                <label htmlFor="yp-pw" className="ls-label-text">Password</label>
                {cfg.showForgotPw !== false && (
                  <button type="button" className="ls-forgot" onClick={() => showToast("Password reset link sent to your email", "✉")}>
                    {cfg.forgotPwText || "Forgot password?"}
                  </button>
                )}
              </div>
              <div className="ls-input-wrap">
                <span className="ls-input-icon"><IconLock /></span>
                <input
                  id="yp-pw"
                  className={`ls-input ls-input-pw${error ? " error" : ""}`}
                  type={showPw ? "text" : "password"} value={password}
                  onChange={e => { setPassword(e.target.value); setError(""); }}
                  placeholder="••••••••"
                  required autoComplete="current-password"
                  aria-describedby={error ? "yp-error" : undefined}
                />
                <button type="button" className="ls-pw-toggle"
                  onClick={() => setShowPw(s => !s)}
                  aria-label={showPw ? "Hide password" : "Show password"}>
                  {showPw ? <IconEyeOff /> : <IconEyeOn />}
                </button>
              </div>
            </div>

            {/* Remember me */}
            {cfg.showRememberMe !== false && <div className="ls-row ls-enter ls-e3">
              <input type="checkbox" id="ls-remember" className="ls-checkbox"
                checked={remember} onChange={e => setRemember(e.target.checked)} />
              <label htmlFor="ls-remember" className="ls-checkbox-label">{cfg.rememberMeText || "Remember this device"}</label>
            </div>}

            {/* Error */}
            {error && (
              <div id="yp-error" className="ls-error" role="alert">
                <IconAlert /> {error}
              </div>
            )}

            {/* Sign in button */}
            <button
              type="submit"
              className="ls-btn ls-enter ls-e4"
              disabled={loading || pkLoading}
            >
              {loading ? (
                <><div className="ls-spinner" /> {cfg.signingInText || "Signing in…"}</>
              ) : pkLoading ? (
                <><div className="ls-spinner" /> Authenticating…</>
              ) : (
                cfg.signInBtnText || "Sign in →"
              )}
            </button>

            {/* Alt auth buttons */}
            <div className="ls-alt-row ls-enter ls-e4">
              {cfg.showPasskey !== false && <button
                className="ls-alt-btn passkey"
                onClick={() => setShowPasskey(true)}
                title={PASSKEY_SUPPORTED ? "Sign in with Passkey" : "Passkeys not supported on this device"}
              >
                <IconKey />
                Passkey
              </button>}
              {cfg.showGoogle !== false && <button className="ls-alt-btn" onClick={() => handleSSO("Google")}>
                <IconGoogle />
                Google
              </button>}
              {cfg.showMicrosoft !== false && <button className="ls-alt-btn" onClick={() => handleSSO("Microsoft")}>
                <IconMicrosoft />
                Microsoft
              </button>}
            </div>

            {/* Biometric hint — shown on touch devices */}
            {cfg.showBiometric !== false && <button type="button" className="ls-bio-hint ls-enter ls-e4" onClick={() => setShowPasskey(true)}>
              <IconFingerprint />
              <span>{cfg.biometricText || "Use Face ID / Touch ID / Biometric to sign in"}</span>
            </button>}

            </form>

            {/* Divider */}
            {cfg.showQuickAccess !== false && <>
            <div className="ls-divider ls-enter ls-e5">
              <div className="ls-divider-line" />
              <span className="ls-divider-text">{cfg.quickAccessLabel || "quick access"}</span>
              <div className="ls-divider-line" />
            </div>

            {/* Quick login grid */}
            <div className="ls-quick-label ls-enter ls-e5">{cfg.teamMembersLabel || "Team members"}</div>
            <div className="ls-quick-grid ls-enter ls-e5">
              {USERS.map(u => {
                const meta = ROLE_META[u.role];
                return (
                  <button key={u.id} className="ls-quick-btn"
                    style={{
                      "--qbtn-bg":     meta.bg,
                      "--qbtn-border": meta.border,
                      "--qbtn-shadow": meta.bg,
                    }}
                    onClick={() => quickLogin(u)}>
                    <div className="ls-avatar"
                      style={{ background: meta.bg, color: meta.color, "--rc": meta.color }}>
                      {u.avatar}
                      <span className="ls-avatar-badge" style={{ color: meta.color }}>{meta.glyph}</span>
                    </div>
                    <div>
                      <div className="ls-quick-name">{u.name}</div>
                      <div className="ls-quick-role" style={{ color: meta.color }}>{u.role}</div>
                    </div>
                  </button>
                );
              })}
            </div>
            </>}

            {/* Footer */}
            <div className="ls-footer ls-enter ls-e6">
              <div className="ls-footer-text">
                <span className="ls-status-dot" />
                {cfg.footerCopyright || "© 2025 Yes Pinoy Pro"}
              </div>
              <div className="ls-footer-links">
                {cfg.privacyUrl && <a className="ls-footer-link" href={cfg.privacyUrl} target="_blank" rel="noopener noreferrer">Privacy</a>}
                {cfg.termsUrl && <a className="ls-footer-link" href={cfg.termsUrl} target="_blank" rel="noopener noreferrer">Terms & Conditions</a>}
                {cfg.websiteUrl && <a className="ls-footer-link" href={cfg.websiteUrl} target="_blank" rel="noopener noreferrer">Our Website</a>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
