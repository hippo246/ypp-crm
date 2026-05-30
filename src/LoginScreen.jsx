import { useState, useEffect, useRef } from "react";

const USERS = [
  { id: 1, name: "Alex Reyes",    role: "Admin",      avatar: "AR", email: "alex@yespinoy.ae",  password: "admin123" },
  { id: 2, name: "Sarah Mendoza", role: "Sales",      avatar: "SM", email: "sarah@yespinoy.ae", password: "sales123" },
  { id: 3, name: "Mike Tan",      role: "Accountant", avatar: "MT", email: "mike@yespinoy.ae",  password: "acct123"  },
  { id: 4, name: "Lena Cruz",     role: "Operations", avatar: "LC", email: "lena@yespinoy.ae",  password: "ops123"   },
];

const ROLE_META = {
  Admin:      { color: "#C084FC", bg: "rgba(192,132,252,0.13)", border: "rgba(192,132,252,0.25)", glyph: "⬡" },
  Sales:      { color: "#34D399", bg: "rgba(52,211,153,0.13)",  border: "rgba(52,211,153,0.25)",  glyph: "◈" },
  Accountant: { color: "#FBBF24", bg: "rgba(251,191,36,0.13)",  border: "rgba(251,191,36,0.25)",  glyph: "◇" },
  Operations: { color: "#60A5FA", bg: "rgba(96,165,250,0.13)",  border: "rgba(96,165,250,0.25)",  glyph: "○" },
};



const STATS = [
  { label: "Active clients",   value: "5",       sub: "+1 this week",  color: "#C084FC" },
  { label: "Open invoices",    value: "AED 41k", sub: "4 outstanding", color: "#FBBF24" },
  { label: "Tasks due today",  value: "3",       sub: "2 overdue",     color: "#FB7185" },
  { label: "Deals this month", value: "9",       sub: "↑ 28% MoM",    color: "#34D399" },
];

/* ─── CSS ─── */
const css = `
@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap');

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

.yp-root {
  display: flex;
  height: 100vh;
  width: 100%;
  overflow: hidden;
  font-family: 'DM Sans', sans-serif;
  background: #080810;
  color: #fff;
}

/* ── ANIMATED ORBS ── */
.yp-orb {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  filter: blur(60px);
  opacity: 0.18;
  animation: orbFloat 12s ease-in-out infinite;
}
.yp-orb-1 { width: 340px; height: 340px; background: #7C3AED; bottom: -80px; left: -80px; animation-delay: 0s; }
.yp-orb-2 { width: 200px; height: 200px; background: #C084FC; top: 60px; right: 20px; animation-delay: -4s; opacity: 0.1; }
.yp-orb-3 { width: 160px; height: 160px; background: #818CF8; top: -40px; left: 160px; animation-delay: -8s; opacity: 0.12; }
@keyframes orbFloat {
  0%, 100% { transform: translateY(0px) scale(1); }
  33%  { transform: translateY(-18px) scale(1.04); }
  66%  { transform: translateY(10px) scale(0.97); }
}

/* ── LEFT PANEL ── */
.yp-left {
  width: 440px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  padding: 44px 44px 36px;
  position: relative;
  overflow: hidden;
  background: #080810;
  border-right: 1px solid rgba(255,255,255,0.055);
}

.yp-grid-bg {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.022) 1px, transparent 1px);
  background-size: 44px 44px;
  pointer-events: none;
}
.yp-grid-fade {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at 50% 100%, #080810 30%, transparent 70%);
  pointer-events: none;
}

/* Logo */
.yp-logo {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 48px;
  position: relative;
  z-index: 1;
}
.yp-logo-mark {
  width: 38px;
  height: 38px;
  border-radius: 9px;
  background: linear-gradient(135deg, #C084FC 0%, #818CF8 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  box-shadow: 0 0 22px rgba(192,132,252,0.45), inset 0 1px 0 rgba(255,255,255,0.2);
}
.yp-logo-name { font-size: 13px; font-weight: 600; letter-spacing: 0.07em; text-transform: uppercase; color: #fff; }
.yp-logo-sub  { font-size: 11px; color: rgba(255,255,255,0.28); letter-spacing: 0.03em; margin-top: 1px; }

/* Headline */
.yp-headline { position: relative; z-index: 1; margin-bottom: 12px; }
.yp-eyebrow {
  font-size: 10px; font-weight: 600; letter-spacing: 0.14em;
  text-transform: uppercase; color: #C084FC; margin-bottom: 10px;
  display: flex; align-items: center; gap: 8px;
}
.yp-eyebrow::before {
  content: '';
  display: inline-block;
  width: 20px; height: 1px;
  background: #C084FC;
}
.yp-headline-title {
  font-family: 'DM Serif Display', serif;
  font-size: 40px;
  line-height: 1.12;
  color: #fff;
  letter-spacing: -0.01em;
}
.yp-headline-title em { font-style: italic; color: #C084FC; }

.yp-tagline {
  position: relative; z-index: 1;
  font-size: 13.5px; color: rgba(255,255,255,0.34);
  line-height: 1.7; margin-bottom: 36px; max-width: 300px;
  font-weight: 300;
}

/* Stats grid */
.yp-stats-grid {
  position: relative; z-index: 1;
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 8px; margin-bottom: 0; flex: 1; align-content: start;
}
.yp-stat-card {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 12px;
  padding: 14px 14px 12px;
  position: relative;
  overflow: hidden;
  transition: border-color 0.2s, background 0.2s;
}
.yp-stat-card:hover {
  background: rgba(255,255,255,0.05);
  border-color: rgba(255,255,255,0.1);
}
.yp-stat-card-accent {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 2px;
  border-radius: 12px 12px 0 0;
}
.yp-stat-val {
  font-size: 20px; font-weight: 600;
  color: #fff; letter-spacing: -0.03em;
  margin-bottom: 3px; line-height: 1;
}
.yp-stat-lbl { font-size: 11px; color: rgba(255,255,255,0.38); font-weight: 400; margin-bottom: 4px; }
.yp-stat-sub { font-size: 10px; color: rgba(255,255,255,0.22); font-weight: 400; }



.yp-footer {
  position: relative; z-index: 1;
  margin-top: 16px;
  font-size: 10px; color: rgba(255,255,255,0.12); letter-spacing: 0.04em;
  display: flex; align-items: center; justify-content: space-between;
}
.yp-status-badge {
  display: flex; align-items: center; gap: 5px;
  font-size: 10px; color: rgba(255,255,255,0.2);
}
.yp-status-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: #34D399;
  box-shadow: 0 0 4px #34D399;
}

/* ── RIGHT PANEL ── */
.yp-right {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px;
  background: #0C0C16;
  position: relative;
  overflow: hidden;
}
.yp-right-orb1 {
  position: absolute;
  top: -120px; right: -120px;
  width: 420px; height: 420px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(129,140,248,0.09) 0%, transparent 70%);
  pointer-events: none;
}
.yp-right-orb2 {
  position: absolute;
  bottom: -60px; left: -60px;
  width: 280px; height: 280px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(52,211,153,0.05) 0%, transparent 70%);
  pointer-events: none;
}

.yp-form-wrap {
  width: 100%; max-width: 390px;
  position: relative; z-index: 1;
}

/* Clock */
.yp-clock {
  font-size: 11px; color: rgba(255,255,255,0.2);
  letter-spacing: 0.06em; margin-bottom: 28px;
  font-weight: 400;
}
.yp-clock span { color: rgba(255,255,255,0.35); }

/* Form header */
.yp-form-header { margin-bottom: 32px; }
.yp-form-title {
  font-size: 26px; font-weight: 600;
  color: #fff; letter-spacing: -0.025em; margin-bottom: 6px;
}
.yp-form-sub { font-size: 13px; color: rgba(255,255,255,0.28); font-weight: 300; }

/* Fields */
.yp-field { margin-bottom: 14px; }
.yp-label {
  display: block;
  font-size: 10px; font-weight: 600;
  letter-spacing: 0.1em; text-transform: uppercase;
  color: rgba(255,255,255,0.35); margin-bottom: 8px;
}
.yp-input-wrap { position: relative; }
.yp-input-icon {
  position: absolute; left: 14px; top: 50%;
  transform: translateY(-50%);
  color: rgba(255,255,255,0.2);
  pointer-events: none; display: flex;
}
.yp-input {
  width: 100%;
  padding: 13px 16px 13px 42px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 11px;
  font-size: 14px; color: #fff;
  font-family: 'DM Sans', sans-serif;
  outline: none;
  transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
  -webkit-appearance: none;
}
.yp-input::placeholder { color: rgba(255,255,255,0.15); }
.yp-input:focus {
  border-color: rgba(192,132,252,0.45);
  background: rgba(255,255,255,0.055);
  box-shadow: 0 0 0 3px rgba(192,132,252,0.09);
}
.yp-input.has-error {
  border-color: rgba(251,113,133,0.5);
  box-shadow: 0 0 0 3px rgba(251,113,133,0.07);
}
.yp-input-pw { padding-right: 46px; }

.yp-pw-toggle {
  position: absolute; right: 12px; top: 50%;
  transform: translateY(-50%);
  background: none; border: none; cursor: pointer;
  color: rgba(255,255,255,0.2); padding: 4px;
  display: flex; align-items: center; border-radius: 4px;
  transition: color 0.15s;
}
.yp-pw-toggle:hover { color: rgba(255,255,255,0.55); }

/* Forgot */
.yp-field-row {
  display: flex; align-items: center;
  justify-content: space-between; margin-bottom: 8px;
}
.yp-forgot {
  font-size: 11px; color: rgba(192,132,252,0.6);
  background: none; border: none; cursor: pointer;
  font-family: 'DM Sans', sans-serif;
  padding: 0; transition: color 0.15s;
}
.yp-forgot:hover { color: #C084FC; }

/* Error */
.yp-error {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px;
  background: rgba(251,113,133,0.07);
  border: 1px solid rgba(251,113,133,0.18);
  border-radius: 8px;
  font-size: 12px; color: #FCA5A5;
  margin-bottom: 12px;
  animation: errShake 0.35s ease;
}
@keyframes errShake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-5px); }
  40% { transform: translateX(5px); }
  60% { transform: translateX(-3px); }
  80% { transform: translateX(3px); }
}

/* Submit btn */
.yp-btn {
  width: 100%;
  padding: 14px;
  margin-top: 4px;
  background: linear-gradient(135deg, #C084FC 0%, #818CF8 100%);
  border: none; border-radius: 11px;
  font-size: 14px; font-weight: 600; color: #fff;
  font-family: 'DM Sans', sans-serif;
  cursor: pointer; letter-spacing: 0.01em;
  transition: opacity 0.15s, transform 0.15s, box-shadow 0.2s;
  box-shadow: 0 4px 24px rgba(192,132,252,0.28), inset 0 1px 0 rgba(255,255,255,0.15);
  position: relative; overflow: hidden;
}
.yp-btn::after {
  content: '';
  position: absolute; inset: 0;
  background: linear-gradient(135deg, rgba(255,255,255,0.08) 0%, transparent 60%);
  pointer-events: none;
}
.yp-btn:hover:not(:disabled) {
  opacity: 0.9;
  transform: translateY(-1px);
  box-shadow: 0 8px 32px rgba(192,132,252,0.38), inset 0 1px 0 rgba(255,255,255,0.15);
}
.yp-btn:active:not(:disabled) { transform: translateY(0); }
.yp-btn:disabled { opacity: 0.45; cursor: not-allowed; }

/* Success state */
.yp-success {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 16px; padding: 32px 0;
  animation: fadeUp 0.4s ease;
}
.yp-success-ring {
  width: 64px; height: 64px; border-radius: 50%;
  background: rgba(52,211,153,0.12);
  border: 1px solid rgba(52,211,153,0.3);
  display: flex; align-items: center; justify-content: center;
  animation: successPop 0.5s cubic-bezier(0.34,1.56,0.64,1) both;
}
@keyframes successPop {
  from { transform: scale(0.4); opacity: 0; }
  to   { transform: scale(1);   opacity: 1; }
}
.yp-success-label { font-size: 16px; font-weight: 600; color: #fff; }
.yp-success-sub   { font-size: 13px; color: rgba(255,255,255,0.3); }

/* Divider */
.yp-divider {
  display: flex; align-items: center; gap: 14px;
  margin: 24px 0 18px;
}
.yp-divider-line { flex: 1; height: 1px; background: rgba(255,255,255,0.065); }
.yp-divider-text { font-size: 10px; color: rgba(255,255,255,0.18); white-space: nowrap; letter-spacing: 0.07em; text-transform: uppercase; }

/* Quick login */
.yp-quick-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 7px;
}
.yp-quick-btn {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  background: rgba(255,255,255,0.025);
  border: 1px solid rgba(255,255,255,0.065);
  border-radius: 11px;
  cursor: pointer; font-family: 'DM Sans', sans-serif;
  text-align: left;
  transition: border-color 0.15s, background 0.15s, transform 0.12s, box-shadow 0.15s;
}
.yp-quick-btn:hover {
  background: rgba(255,255,255,0.05);
  transform: translateY(-1px);
}
.yp-quick-btn:active { transform: translateY(0); }

.yp-avatar {
  width: 30px; height: 30px; border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; flex-shrink: 0;
  letter-spacing: 0.01em; position: relative;
  transition: box-shadow 0.15s;
}
.yp-quick-btn:hover .yp-avatar {
  box-shadow: 0 0 12px var(--role-color, rgba(192,132,252,0.4));
}
.yp-avatar-glyph {
  position: absolute; bottom: -3px; right: -3px;
  font-size: 8px; line-height: 1;
}
.yp-quick-name { font-size: 12px; font-weight: 500; color: rgba(255,255,255,0.82); line-height: 1.2; }
.yp-quick-role { font-size: 10px; margin-top: 1px; font-weight: 400; opacity: 0.85; }

/* Demo hint */
.yp-demo-hint {
  margin-top: 12px; padding: 9px 14px;
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.05);
  border-radius: 8px;
  font-size: 11px; color: rgba(255,255,255,0.2);
  text-align: center; letter-spacing: 0.01em; line-height: 1.5;
}
.yp-demo-hint strong { color: rgba(255,255,255,0.38); font-weight: 600; }
.yp-demo-hint code {
  background: rgba(255,255,255,0.06);
  border-radius: 4px; padding: 1px 5px;
  font-family: 'DM Sans', monospace; font-size: 10px;
  color: rgba(255,255,255,0.4);
}

/* Spinner */
.yp-spinner {
  display: inline-block;
  width: 14px; height: 14px;
  border: 2px solid rgba(255,255,255,0.25);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.55s linear infinite;
  vertical-align: -2px; margin-right: 8px;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* Fade/slide in */
.yp-enter { animation: fadeUp 0.45s ease both; }
.yp-enter-1 { animation-delay: 0.04s; }
.yp-enter-2 { animation-delay: 0.09s; }
.yp-enter-3 { animation-delay: 0.14s; }
.yp-enter-4 { animation-delay: 0.19s; }
.yp-enter-5 { animation-delay: 0.24s; }
.yp-enter-6 { animation-delay: 0.29s; }
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(14px); }
  to   { opacity: 1; transform: translateY(0); }
}

@media (max-width: 740px) {
  .yp-left { display: none !important; }
  .yp-right { padding: 28px; }
}
`;

/* ── Clock ── */
function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const h = time.getHours().toString().padStart(2,"0");
  const m = time.getMinutes().toString().padStart(2,"0");
  const s = time.getSeconds().toString().padStart(2,"0");
  const day = time.toLocaleDateString("en-AE", { weekday:"long", month:"short", day:"numeric" });
  return (
    <div className="yp-clock">
      {day} · <span>{h}:{m}:{s} GST</span>
    </div>
  );
}

/* ── Eye icon ── */
const EyeOn  = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
const EyeOff = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>;
const MailIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>;
const LockIcon = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>;
const CheckIcon = () => <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;
const AlertIcon = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>;

/* ── Main ── */
export default function LoginScreen({ onLogin }) {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [showPw,   setShowPw]   = useState(false);
  const [success,  setSuccess]  = useState(null);   // user object on success
  const [hoveredQ, setHoveredQ] = useState(null);

  function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    setTimeout(() => {
      const user = USERS.find(
        u => u.email.toLowerCase() === email.toLowerCase().trim() && u.password === password
      );
      if (user) {
        setSuccess(user);
        setTimeout(() => onLogin(user), 900);
      } else {
        setError("Invalid email or password.");
        setLoading(false);
      }
    }, 700);
  }

  function quickLogin(user) {
    setSuccess(user);
    setTimeout(() => onLogin(user), 900);
  }

  return (
    <>
      <style>{css}</style>
      <div className="yp-root">

        {/* ══ LEFT ══ */}
        <div className="yp-left">
          <div className="yp-grid-bg" />
          <div className="yp-grid-fade" />
          <div className="yp-orb yp-orb-1" />
          <div className="yp-orb yp-orb-2" />
          <div className="yp-orb yp-orb-3" />

          {/* Logo */}
          <div className="yp-logo">
            <div className="yp-logo-mark">🌞</div>
            <div>
              <div className="yp-logo-name">Yes Pinoy Pro</div>
              <div className="yp-logo-sub">Business CRM · Dubai, UAE</div>
            </div>
          </div>

          {/* Headline */}
          <div className="yp-headline">
            <div className="yp-eyebrow">Dashboard</div>
            <div className="yp-headline-title">
              Your business,<br /><em>always on.</em>
            </div>
          </div>

          <p className="yp-tagline">
            One workspace for clients, invoices, leads, and team operations. Sign in to pick up where you left off.
          </p>

          {/* Stats 2×2 grid */}
          <div className="yp-stats-grid" style={{ marginBottom: 28 }}>
            {STATS.map((s,i) => (
              <div className="yp-stat-card" key={i}>
                <div className="yp-stat-card-accent" style={{ background: s.color }} />
                <div className="yp-stat-lbl">{s.label}</div>
                <div className="yp-stat-val">{s.value}</div>
                <div className="yp-stat-sub">{s.sub}</div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="yp-footer">
            <span>© 2025 Yes Pinoy Pro</span>
            <div className="yp-status-badge">
              <div className="yp-status-dot" />
              All systems operational
            </div>
          </div>
        </div>

        {/* ══ RIGHT ══ */}
        <div className="yp-right">
          <div className="yp-right-orb1" />
          <div className="yp-right-orb2" />

          <div className="yp-form-wrap">
            <LiveClock />

            {success ? (
              /* Success state */
              <div className="yp-success">
                <div className="yp-success-ring"><CheckIcon /></div>
                <div style={{ textAlign: "center" }}>
                  <div className="yp-success-label">Welcome, {success.name.split(" ")[0]} 👋</div>
                  <div className="yp-success-sub">Signing you in as {success.role}…</div>
                </div>
              </div>
            ) : (<>

              {/* Form header */}
              <div className="yp-form-header yp-enter">
                <div className="yp-form-title">Sign in</div>
                <div className="yp-form-sub">Enter your credentials to continue</div>
              </div>

              <form onSubmit={handleSubmit}>
                {/* Email */}
                <div className="yp-field yp-enter yp-enter-1">
                  <label className="yp-label" htmlFor="yp-email">Email address</label>
                  <div className="yp-input-wrap">
                    <span className="yp-input-icon"><MailIcon /></span>
                    <input
                      id="yp-email"
                      className={`yp-input${error ? " has-error" : ""}`}
                      type="email" value={email}
                      onChange={e => { setEmail(e.target.value); setError(""); }}
                      placeholder="you@yespinoy.ae"
                      required autoComplete="email" aria-label="Email address"
                    />
                  </div>
                </div>

                {/* Password */}
                <div className="yp-field yp-enter yp-enter-2">
                  <div className="yp-field-row">
                    <label className="yp-label" htmlFor="yp-pw">Password</label>
                    <button type="button" className="yp-forgot">Forgot password?</button>
                  </div>
                  <div className="yp-input-wrap">
                    <span className="yp-input-icon"><LockIcon /></span>
                    <input
                      id="yp-pw"
                      className={`yp-input yp-input-pw${error ? " has-error" : ""}`}
                      type={showPw ? "text" : "password"} value={password}
                      onChange={e => { setPassword(e.target.value); setError(""); }}
                      placeholder="••••••••"
                      required autoComplete="current-password" aria-label="Password"
                    />
                    <button type="button" className="yp-pw-toggle"
                      onClick={() => setShowPw(!showPw)}
                      aria-label={showPw ? "Hide password" : "Show password"}>
                      {showPw ? <EyeOff /> : <EyeOn />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="yp-error" role="alert">
                    <AlertIcon /> {error}
                  </div>
                )}

                <button type="submit" className="yp-btn yp-enter yp-enter-3" disabled={loading}>
                  {loading ? <><span className="yp-spinner" />Signing in…</> : "Sign in →"}
                </button>
              </form>

              {/* Divider */}
              <div className="yp-divider yp-enter yp-enter-4">
                <div className="yp-divider-line" />
                <span className="yp-divider-text">quick access</span>
                <div className="yp-divider-line" />
              </div>

              {/* Quick login */}
              <div className="yp-quick-grid yp-enter yp-enter-5">
                {USERS.map(u => {
                  const meta = ROLE_META[u.role];
                  return (
                    <button key={u.id} className="yp-quick-btn"
                      style={hoveredQ === u.id ? { borderColor: meta.border, boxShadow: `0 4px 16px ${meta.bg}` } : {}}
                      onMouseEnter={() => setHoveredQ(u.id)}
                      onMouseLeave={() => setHoveredQ(null)}
                      onClick={() => quickLogin(u)}>
                      <div className="yp-avatar"
                        style={{ background: meta.bg, color: meta.color, "--role-color": meta.color }}>
                        {u.avatar}
                        <span className="yp-avatar-glyph" style={{ color: meta.color }}>{meta.glyph}</span>
                      </div>
                      <div>
                        <div className="yp-quick-name">{u.name}</div>
                        <div className="yp-quick-role" style={{ color: meta.color }}>{u.role}</div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="yp-demo-hint yp-enter yp-enter-6">
                <strong>Demo</strong> — password is role + <code>123</code> &nbsp;·&nbsp;
                e.g. <code>admin123</code> or <code>ops123</code>
              </div>

            </>)}
          </div>
        </div>

      </div>
    </>
  );
}
