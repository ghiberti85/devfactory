import { useState } from "react"

const T = {
  bg0: "#080808", bg1: "#0f0f0f", bg2: "#141414",
  border: "#222222", text0: "#f1f5f9", text2: "#475569", violet: "#a78bfa", red: "#f87171",
}
const mono = { fontFamily: "'JetBrains Mono','Fira Code','Courier New',monospace" }

/**
 * AuthGate — tela de login (magic link / OAuth).
 *
 * onLogin recebe { provider: 'magic'|'github'|'google', email? } e deve
 * disparar a chamada real ao Supabase Auth:
 *   supabase.auth.signInWithOtp({ email })               // magic link
 *   supabase.auth.signInWithOAuth({ provider: 'github' }) // OAuth
 */
export default function AuthGate({ onLogin }) {
  const [email, setEmail] = useState("")
  const [mode,  setMode]  = useState("magic")
  const [sent,  setSent]  = useState(false)
  const [error, setError] = useState(null)

  async function handleMagicLink() {
    if (!email.includes("@")) return
    setError(null)
    try {
      await onLogin({ provider: "magic", email })
      setSent(true)
    } catch (err) {
      setError(err?.message ?? "Falha ao enviar o link.")
    }
  }

  async function handleOAuth(provider) {
    setError(null)
    try {
      await onLogin({ provider })
    } catch (err) {
      setError(err?.message ?? "Falha ao autenticar.")
    }
  }

  return (
    <div style={{ background: T.bg0, minHeight: "100vh", color: T.text0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter',-apple-system,sans-serif", padding: 20, boxSizing: "border-box" }}>
      <div style={{ maxWidth: 360, width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ width: 48, height: 48, margin: "0 auto 14px", background: `linear-gradient(135deg, ${T.violet}, #60a5fa)`, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22 }}>🏭</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>DevFactory</div>
          <div style={{ ...mono, fontSize: 10, color: T.text2, marginTop: 4 }}>Autonomous Software Factory</div>
        </div>

        <div style={{ background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 12, padding: 22, boxSizing: "border-box" }}>
          {!sent ? (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                {[{ id: "magic", label: "Email" }, { id: "oauth", label: "GitHub / Google" }].map(m => (
                  <button key={m.id} onClick={() => setMode(m.id)} style={{
                    ...mono, fontSize: 11, flex: 1, padding: "7px 0", borderRadius: 6,
                    border: `1px solid ${mode === m.id ? T.violet : T.border}`,
                    background: mode === m.id ? `${T.violet}15` : "transparent",
                    color: mode === m.id ? T.violet : T.text2, cursor: "pointer",
                  }}>
                    {m.label}
                  </button>
                ))}
              </div>

              {mode === "magic" ? (
                <>
                  <input
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="seu@email.com"
                    style={{ width: "100%", background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px", color: T.text0, fontSize: 13, marginBottom: 10, boxSizing: "border-box" }}
                  />
                  <button
                    onClick={handleMagicLink}
                    disabled={!email.includes("@")}
                    style={{ ...mono, width: "100%", padding: "10px 0", borderRadius: 8, border: "none", background: email.includes("@") ? T.violet : T.bg2, color: email.includes("@") ? "#fff" : T.text2, fontSize: 12, fontWeight: 600, cursor: email.includes("@") ? "pointer" : "not-allowed" }}
                  >
                    Enviar link mágico
                  </button>
                  <div style={{ fontSize: 10, color: T.text2, marginTop: 10, textAlign: "center", lineHeight: 1.6 }}>
                    Sem senha — você recebe um link de acesso único por email.
                  </div>
                </>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <button onClick={() => handleOAuth("github")} style={{ ...mono, padding: "10px 0", borderRadius: 8, border: `1px solid ${T.border}`, background: T.bg2, color: T.text0, fontSize: 12, cursor: "pointer" }}>
                    ⚫ Continuar com GitHub
                  </button>
                  <button onClick={() => handleOAuth("google")} style={{ ...mono, padding: "10px 0", borderRadius: 8, border: `1px solid ${T.border}`, background: T.bg2, color: T.text0, fontSize: 12, cursor: "pointer" }}>
                    🔵 Continuar com Google
                  </button>
                </div>
              )}

              {error && <div style={{ ...mono, fontSize: 10, color: T.red, marginTop: 10, textAlign: "center" }}>{error}</div>}
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>📩</div>
              <div style={{ fontSize: 13, color: T.text0 }}>Link enviado para</div>
              <div style={{ ...mono, fontSize: 12, color: T.violet, marginTop: 2 }}>{email}</div>
            </div>
          )}
        </div>

        <div style={{ ...mono, fontSize: 9, color: T.text2, textAlign: "center", marginTop: 16, lineHeight: 1.8 }}>
          Autenticação via Supabase Auth + Row Level Security.<br />
          Cada usuário só acessa seus próprios runs e API keys.
        </div>
      </div>
    </div>
  )
}
