import { useState } from "react";
import { B } from "./constants";

const USERS = [
  { id: 1, name: "Alex Reyes",     role: "Admin",       avatar: "AR", email: "alex@yespinoy.ae",    password: "admin123" },
  { id: 2, name: "Sarah Mendoza",  role: "Sales",       avatar: "SM", email: "sarah@yespinoy.ae",   password: "sales123" },
  { id: 3, name: "Mike Tan",       role: "Accountant",  avatar: "MT", email: "mike@yespinoy.ae",    password: "acct123"  },
  { id: 4, name: "Lena Cruz",      role: "Operations",  avatar: "LC", email: "lena@yespinoy.ae",    password: "ops123"   },
];

const ROLE_COLORS = {
  Admin:       { bg: "#1D3557", text: "#fff" },
  Sales:       { bg: "#16A34A", text: "#fff" },
  Accountant:  { bg: "#D97706", text: "#fff" },
  Operations:  { bg: "#7C3AED", text: "#fff" },
};

export default function LoginScreen({ onLogin }) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [showPw, setShowPw]     = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    setTimeout(() => {
      const user = USERS.find(
        (u) => u.email.toLowerCase() === email.toLowerCase().trim() && u.password === password
      );
      if (user) {
        onLogin(user);
      } else {
        setError("Invalid email or password.");
        setLoading(false);
      }
    }, 600);
  }

  function quickLogin(user) {
    setLoading(true);
    setTimeout(() => onLogin(user), 400);
  }

  return (
    <div style={{
      display: "flex", height: "100vh", width: "100%", overflow: "hidden",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      background: B.bg,
    }}>
      {/* Left panel — hidden on narrow viewports via inline media-query substitute */}
      <style>{`@media (max-width: 680px) { .login-left { display: none !important; } .login-right { padding: 24px !important; } }`}</style>
      <div className="login-left" style={{
        width: 420, flexShrink: 0, background: B.blue,
        display: "flex", flexDirection: "column", padding: "48px 40px",
        position: "relative", overflow: "hidden",
      }}>
        {/* decorative circles */}
        <div style={{ position: "absolute", top: -60, right: -60, width: 220, height: 220, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.07)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: -20, right: -20, width: 120, height: 120, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.1)", pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: 60, left: -40, width: 180, height: 180, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.06)", pointerEvents: "none" }} />

        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 56 }}>
          <div style={{ width: 36, height: 36, background: B.yellow, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🌞</div>
          <div>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 14, letterSpacing: "0.3px" }}>YES PINOY PRO</div>
            <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>Business CRM</div>
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#fff", lineHeight: 1.25, marginBottom: 12 }}>
            Welcome back
          </div>
          <div style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.6, marginBottom: 40 }}>
            Sign in to manage your clients, invoices, leads and operations.
          </div>

          {/* Stats */}
          {[
            { label: "Active clients",  value: "5"  },
            { label: "Open invoices",   value: "4"  },
            { label: "Tasks due today", value: "3"  },
          ].map((s) => (
            <div key={s.label} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.07)",
            }}>
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.45)" }}>{s.label}</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: B.yellow }}>{s.value}</span>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 32 }}>
          © 2025 Yes Pinoy Pro · Dubai, UAE
        </div>
      </div>

      {/* Right panel */}
      <div className="login-right" style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        padding: 40,
      }}>
        <div style={{ width: "100%", maxWidth: 400 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: B.text, marginBottom: 4 }}>Sign in</div>
          <div style={{ fontSize: 13, color: B.muted, marginBottom: 32 }}>Enter your credentials to continue</div>

          <form onSubmit={handleSubmit}>
            {/* Email */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: B.text, display: "block", marginBottom: 6 }}>Email address</label>
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yespinoy.ae" required
                aria-label="Email address" autoComplete="email"
                style={{
                  width: "100%", boxSizing: "border-box", padding: "10px 12px",
                  border: `1px solid ${error ? B.red : B.border}`, borderRadius: 8,
                  fontSize: 13, color: B.text, background: B.white, outline: "none",
                  fontFamily: "inherit", transition: "border-color 0.15s",
                }}
                onFocus={(e) => e.target.style.borderColor = B.accent}
                onBlur={(e) => e.target.style.borderColor = error ? B.red : B.border}
              />
            </div>

            {/* Password */}
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: B.text, display: "block", marginBottom: 6 }}>Password</label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPw ? "text" : "password"} value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••" required
                  aria-label="Password" autoComplete="current-password"
                  style={{
                    width: "100%", boxSizing: "border-box", padding: "10px 40px 10px 12px",
                    border: `1px solid ${error ? B.red : B.border}`, borderRadius: 8,
                    fontSize: 13, color: B.text, background: B.white, outline: "none",
                    fontFamily: "inherit", transition: "border-color 0.15s",
                  }}
                  onFocus={(e) => e.target.style.borderColor = B.accent}
                  onBlur={(e) => e.target.style.borderColor = error ? B.red : B.border}
                />
                <button type="button" onClick={() => setShowPw(!showPw)} aria-label={showPw ? "Hide password" : "Show password"}
                  style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: B.muted, padding: 4, display: "flex", alignItems: "center", borderRadius: 4, transition: "color 0.15s" }}
                  onMouseEnter={(e) => e.currentTarget.style.color = B.text}
                  onMouseLeave={(e) => e.currentTarget.style.color = B.muted}>
                  {showPw ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <div style={{ fontSize: 12, color: B.red, marginBottom: 12, padding: "8px 10px", background: "#FEF2F2", borderRadius: 6, border: "1px solid #FECACA" }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading}
              style={{
                width: "100%", padding: "11px", marginTop: 8,
                background: loading ? B.muted : B.blue, color: "#fff",
                border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer", fontFamily: "inherit",
                transition: "background 0.15s",
              }}>
              {loading ? "Signing in…" : "Sign in →"}
            </button>
          </form>

          {/* Divider */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "28px 0 20px" }}>
            <div style={{ flex: 1, height: 1, background: B.border }} />
            <span style={{ fontSize: 11, color: B.muted, whiteSpace: "nowrap" }}>or quick access</span>
            <div style={{ flex: 1, height: 1, background: B.border }} />
          </div>

          {/* Quick login cards */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {USERS.map((u) => (
              <button key={u.id} onClick={() => quickLogin(u)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                  background: B.white, border: `1px solid ${B.border}`, borderRadius: 8,
                  cursor: "pointer", fontFamily: "inherit", textAlign: "left",
                  transition: "border-color 0.15s, box-shadow 0.15s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = B.accent; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(69,123,157,0.1)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = B.border; e.currentTarget.style.boxShadow = "none"; }}
              >
                <div style={{
                  width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
                  background: ROLE_COLORS[u.role].bg, color: ROLE_COLORS[u.role].text,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, fontWeight: 700,
                }}>
                  {u.avatar}
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: B.text, lineHeight: 1.2 }}>{u.name}</div>
                  <div style={{ fontSize: 11, color: B.muted }}>{u.role}</div>
                </div>
              </button>
            ))}
          </div>

          <div style={{ marginTop: 16, fontSize: 11, color: B.muted, textAlign: "center", padding: "8px 12px", background: B.light, borderRadius: 6, border: `1px solid ${B.border}` }}>
            <span style={{ fontWeight: 600 }}>Demo mode:</span> password is role + "123" (e.g. admin123)
          </div>
        </div>
      </div>
    </div>
  );
}
