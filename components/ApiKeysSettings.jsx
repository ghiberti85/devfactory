import { useState, useEffect } from "react"

const T = {
  bg0: "#080808", bg1: "#0f0f0f", bg2: "#141414", bg3: "#1c1c1c",
  border: "#222222", border2: "#2a2a2a",
  text0: "#f1f5f9", text1: "#94a3b8", text2: "#475569",
  violet: "#a78bfa", blue: "#60a5fa", green: "#34d399",
  amber: "#fbbf24", red: "#f87171",
}
const mono = { fontFamily: "'JetBrains Mono','Fira Code','Courier New',monospace" }

// ─── Providers suportados ──────────────────────────────────────────────────────
// unlockedTier: tier máximo que o registry consegue oferecer gratuitamente
// nesse provider, mesmo sem key própria (ex: Google sempre libera Tier 1
// via free tier público). Tiers acima disso exigem key própria.

const PROVIDERS = [
  { id: "anthropic", name: "Anthropic",  icon: "🟣", unlockedTier: 0, docsUrl: "https://console.anthropic.com/settings/keys",
    models: "Claude Opus 4.8, Claude Sonnet 4.6", note: "Sem free tier — chave própria obrigatória para qualquer uso." },
  { id: "openai",    name: "OpenAI",     icon: "⚪", unlockedTier: 0, docsUrl: "https://platform.openai.com/api-keys",
    models: "GPT-5.5", note: "Sem free tier — chave própria obrigatória para qualquer uso." },
  { id: "google",    name: "Google AI",  icon: "🔵", unlockedTier: 1, docsUrl: "https://aistudio.google.com/apikey",
    models: "Gemini 2.5 Flash, Flash-Lite, 3.1 Pro", note: "Tier 1 já liberado pela plataforma. Adicione sua key para usar Tier 3 (Gemini 3.1 Pro) sem limite de fila compartilhada." },
  { id: "deepseek",  name: "DeepSeek",   icon: "🟢", unlockedTier: 1, docsUrl: "https://platform.deepseek.com/api_keys",
    models: "DeepSeek V4 Flash, Pro, Pro Max", note: "Tier 1 liberado. Tiers 2 e 3 exigem chave própria — custo ainda muito baixo." },
  { id: "qwen",      name: "Qwen (Alibaba)", icon: "🟠", unlockedTier: 1, docsUrl: "https://dashscope.console.aliyun.com/apiKey",
    models: "Qwen Flash, Plus, Max", note: "Tier 1 liberado pela plataforma." },
  { id: "glm",       name: "GLM (Z.AI)", icon: "🟡", unlockedTier: 1, docsUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    models: "GLM-4.7-Flash (grátis), GLM-5.1", note: "GLM-4.7-Flash é gratuito para todos. GLM-5.1 exige chave própria." },
  { id: "moonshot",  name: "Moonshot (Kimi)", icon: "🌙", unlockedTier: 0, docsUrl: "https://platform.moonshot.cn/console/api-keys",
    models: "Kimi K2.6", note: "Sem free tier — chave própria obrigatória." },
  { id: "minimax",   name: "MiniMax",    icon: "🔴", unlockedTier: 0, docsUrl: "https://www.minimax.io/platform/user-center/basic-information/interface-key",
    models: "MiniMax M3", note: "Sem free tier — chave própria obrigatória." },
  { id: "mistral",   name: "Mistral",    icon: "🟤", unlockedTier: 0, docsUrl: "https://console.mistral.ai/api-keys",
    models: "Mistral Large 3", note: "Sem free tier — chave própria obrigatória." },
  { id: "groq",      name: "Groq",       icon: "⚡", unlockedTier: 1, docsUrl: "https://console.groq.com/keys",
    models: "Llama 4 (via Groq)", note: "Free tier generoso da própria Groq." },
  { id: "openrouter",name: "OpenRouter", icon: "🌐", unlockedTier: 0, docsUrl: "https://openrouter.ai/keys",
    models: "Gateway universal — 100+ modelos", note: "Útil para acessar múltiplos providers com uma única key." },
]

function maskKey(key) {
  if (!key) return ""
  if (key.length <= 8) return "•".repeat(key.length)
  return key.slice(0, 4) + "•".repeat(Math.min(key.length - 8, 20)) + key.slice(-4)
}

function btnGhost(color) {
  return { ...mono, fontSize: 10, padding: "6px 12px", borderRadius: 6, border: `1px solid ${color}44`, background: "transparent", color, cursor: "pointer", whiteSpace: "nowrap" }
}
function btnSolid(color) {
  return { ...mono, fontSize: 10, padding: "6px 12px", borderRadius: 6, border: "none", background: `${color}20`, color, cursor: "pointer", whiteSpace: "nowrap", fontWeight: 600 }
}

function ProviderRow({ provider, savedKey, onSave, onRemove, onTest }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue]     = useState("")
  const [testState, setTestState] = useState(null) // null | 'testing' | 'ok' | 'error'

  const isConfigured = Boolean(savedKey)

  async function handleTest() {
    setTestState("testing")
    const ok = await onTest(provider.id, value || savedKey)
    setTestState(ok ? "ok" : "error")
  }

  function handleSave() {
    if (!value.trim()) return
    onSave(provider.id, value.trim())
    setEditing(false)
    setValue("")
    setTestState(null)
  }

  return (
    <div style={{
      background: T.bg1, border: `1px solid ${isConfigured ? T.green + "30" : T.border}`,
      borderRadius: 10, padding: 14,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span style={{ fontSize: 18 }}>{provider.icon}</span>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: T.text0 }}>{provider.name}</span>
              {isConfigured && (
                <span style={{ ...mono, fontSize: 9, color: T.green, background: `${T.green}15`, border: `1px solid ${T.green}30`, borderRadius: 3, padding: "1px 6px" }}>
                  ✓ configurada
                </span>
              )}
              {!isConfigured && provider.unlockedTier > 0 && (
                <span style={{ ...mono, fontSize: 9, color: T.blue, background: `${T.blue}15`, border: `1px solid ${T.blue}30`, borderRadius: 3, padding: "1px 6px" }}>
                  Tier {provider.unlockedTier} grátis
                </span>
              )}
              {!isConfigured && provider.unlockedTier === 0 && (
                <span style={{ ...mono, fontSize: 9, color: T.text2, background: T.bg3, border: `1px solid ${T.border}`, borderRadius: 3, padding: "1px 6px" }}>
                  bloqueado
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: T.text2, marginTop: 3 }}>{provider.models}</div>
          </div>
        </div>

        <a href={provider.docsUrl} target="_blank" rel="noreferrer" style={{ ...mono, fontSize: 10, color: T.violet, textDecoration: "none", whiteSpace: "nowrap" }}>
          obter key ↗
        </a>
      </div>

      <div style={{ fontSize: 11, color: T.text2, marginTop: 8, lineHeight: 1.5 }}>{provider.note}</div>

      {isConfigured && !editing && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          <span style={{ ...mono, fontSize: 11, color: T.text1, background: T.bg2, borderRadius: 6, padding: "5px 10px", flex: 1 }}>
            {maskKey(savedKey)}
          </span>
          <button onClick={() => setEditing(true)} style={btnGhost(T.blue)}>Trocar</button>
          <button onClick={() => onRemove(provider.id)} style={btnGhost(T.red)}>Remover</button>
        </div>
      )}

      {(!isConfigured || editing) && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <input
            type="password"
            value={value}
            onChange={e => { setValue(e.target.value); setTestState(null) }}
            placeholder={`sk-... (key da ${provider.name})`}
            style={{ flex: 1, minWidth: 180, background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 6, padding: "7px 10px", color: T.text0, fontSize: 12, ...mono }}
          />
          <button onClick={handleTest} disabled={!value.trim()} style={btnGhost(T.text1)}>
            {testState === "testing" ? "Testando..." : "Testar"}
          </button>
          <button onClick={handleSave} disabled={!value.trim()} style={btnSolid(T.green)}>
            Salvar
          </button>
          {editing && (
            <button onClick={() => { setEditing(false); setValue("") }} style={btnGhost(T.text2)}>
              Cancelar
            </button>
          )}
        </div>
      )}

      {testState === "ok" && <div style={{ ...mono, fontSize: 10, color: T.green, marginTop: 6 }}>✓ Conexão validada com sucesso</div>}
      {testState === "error" && <div style={{ ...mono, fontSize: 10, color: T.red, marginTop: 6 }}>✗ Falha ao validar — verifique a key</div>}
    </div>
  )
}

function GitHubConnectionCard() {
  const [status, setStatus] = useState("loading") // 'loading' | 'connected' | 'disconnected'
  const [username, setUsername] = useState(null)
  const [disconnecting, setDisconnecting] = useState(false)

  useEffect(() => {
    // Reflete o resultado do callback OAuth (?github_connected=1 / ?github_error=1)
    const params = new URLSearchParams(window.location.search)
    if (params.get("github_connected")) {
      window.history.replaceState({}, "", window.location.pathname)
    }

    fetch("/api/github/repos")
      .then(r => r.json())
      .then(data => {
        setStatus(data.connected ? "connected" : "disconnected")
        if (data.connected && data.repos?.[0]) {
          setUsername(data.repos[0].fullName.split("/")[0])
        }
      })
      .catch(() => setStatus("disconnected"))
  }, [])

  async function handleDisconnect() {
    setDisconnecting(true)
    try {
      await fetch("/api/github/connect", { method: "DELETE" })
      setStatus("disconnected")
      setUsername(null)
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <div style={{ background: T.bg1, border: `1px solid ${status === "connected" ? T.green + "30" : T.border}`, borderRadius: 10, padding: 14, marginBottom: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 18 }}>⚫</span>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: T.text0 }}>GitHub</span>
              {status === "connected" && (
                <span style={{ ...mono, fontSize: 9, color: T.green, background: `${T.green}15`, border: `1px solid ${T.green}30`, borderRadius: 3, padding: "1px 6px" }}>
                  ✓ conectado{username ? ` como ${username}` : ""}
                </span>
              )}
              {status === "disconnected" && (
                <span style={{ ...mono, fontSize: 9, color: T.text2, background: T.bg3, border: `1px solid ${T.border}`, borderRadius: 3, padding: "1px 6px" }}>
                  não conectado
                </span>
              )}
            </div>
            <div style={{ fontSize: 11, color: T.text2, marginTop: 3 }}>
              Necessário para usar "Repositório existente" ao criar um novo run.
            </div>
          </div>
        </div>

        {status === "connected" ? (
          <button onClick={handleDisconnect} disabled={disconnecting} style={btnGhost(T.red)}>
            {disconnecting ? "Desconectando..." : "Desconectar"}
          </button>
        ) : status === "disconnected" ? (
          <a href="/api/github/connect" style={{ ...btnSolid(T.violet), textDecoration: "none" }}>
            Conectar GitHub
          </a>
        ) : (
          <span style={{ ...mono, fontSize: 10, color: T.text2 }}>Verificando...</span>
        )}
      </div>

      <div style={{ fontSize: 11, color: T.text2, marginTop: 10, lineHeight: 1.5 }}>
        Escopo solicitado: leitura de repositórios (<code>repo</code>). O DevFactory lê a árvore de
        arquivos, README e docs existentes para gerar a etapa de Code Analysis — nunca faz push sem
        sua aprovação explícita em cada gate.
      </div>
    </div>
  )
}

export default function ApiKeysSettings({ onBack }) {
  // Em produção: vem de Supabase, tabela user_api_keys, decifrado server-side
  // e nunca exposto em texto puro além da máscara — aqui é estado local mock.
  const [keys, setKeys] = useState({
    deepseek: "sk-ds-7f8a92b1c4e6d3a0",
  })

  function handleSave(providerId, value) {
    setKeys(prev => ({ ...prev, [providerId]: value }))
  }
  function handleRemove(providerId) {
    setKeys(prev => {
      const next = { ...prev }
      delete next[providerId]
      return next
    })
  }
  async function handleTest(providerId, value) {
    // Em produção: chamada real de validação (ex: GET /v1/models)
    await new Promise(r => setTimeout(r, 700))
    return value.length > 8
  }

  const configuredCount = Object.keys(keys).length
  const unlockedTier3 = configuredCount > 0

  return (
    <div style={{ background: T.bg0, minHeight: "100vh", color: T.text0, fontFamily: "'Inter',-apple-system,sans-serif", padding: "20px 24px 60px", boxSizing: "border-box" }}>
      <style>{`* { box-sizing: border-box; } button { transition: all 0.15s; } input:focus { outline: none; border-color: ${T.violet} !important; }`}</style>

      <div style={{ maxWidth: 680, margin: "0 auto" }}>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          {onBack && (
            <button onClick={onBack} style={{ background: "none", border: "none", color: T.text2, cursor: "pointer", fontSize: 14, padding: 0 }}>←</button>
          )}
          <span style={{ fontSize: 15, fontWeight: 700 }}>🔑 API Keys</span>
        </div>
        <div style={{ ...mono, fontSize: 10, color: T.text2, marginBottom: 20 }}>
          Bring Your Own Key — suas chaves, seus custos, seus dados.
        </div>

        <div style={{
          background: `${T.violet}08`, border: `1px solid ${T.violet}30`, borderRadius: 10,
          padding: 14, marginBottom: 20, fontSize: 12, color: T.text1, lineHeight: 1.7,
        }}>
          <strong style={{ color: T.violet }}>Como funciona:</strong> por padrão, o DevFactory usa apenas
          modelos gratuitos (free tier de Google/DeepSeek/Qwen/GLM ou modelos locais). Para usar modelos
          pagos como Claude Opus ou GPT-5.5, você precisa configurar sua própria API key abaixo — ela é
          usada exclusivamente nos seus runs, nunca compartilhada com outros usuários da plataforma, e
          armazenada de forma criptografada.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 24 }}>
          <div style={{ background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 10, padding: 14 }}>
            <div style={{ ...mono, fontSize: 20, fontWeight: 700, color: configuredCount > 0 ? T.green : T.text2 }}>{configuredCount}</div>
            <div style={{ fontSize: 11, color: T.text2, marginTop: 3 }}>Providers configurados</div>
          </div>
          <div style={{ background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 10, padding: 14 }}>
            <div style={{ ...mono, fontSize: 13, fontWeight: 700, color: unlockedTier3 ? T.violet : T.amber }}>
              {unlockedTier3 ? "Tier 1–3 disponível" : "Apenas Tier 1 (grátis)"}
            </div>
            <div style={{ fontSize: 11, color: T.text2, marginTop: 3 }}>Acesso atual do seu projeto</div>
          </div>
        </div>

        <div style={{ ...mono, fontSize: 10, letterSpacing: 1.5, color: T.text2, textTransform: "uppercase", marginBottom: 10 }}>
          Repositório (GitHub)
        </div>
        <GitHubConnectionCard />

        <div style={{ ...mono, fontSize: 10, letterSpacing: 1.5, color: T.text2, textTransform: "uppercase", marginBottom: 10 }}>
          Modelos de IA (LLM)
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {PROVIDERS.map(p => (
            <ProviderRow
              key={p.id}
              provider={p}
              savedKey={keys[p.id]}
              onSave={handleSave}
              onRemove={handleRemove}
              onTest={handleTest}
            />
          ))}
        </div>

        <div style={{ ...mono, fontSize: 10, color: T.text2, marginTop: 24, lineHeight: 1.8, textAlign: "center" }}>
          🔒 Keys são criptografadas em repouso (Supabase Vault) e descriptografadas apenas no<br/>
          momento da chamada ao modelo, dentro do seu próprio run. Nunca expostas no front-end.
        </div>
      </div>
    </div>
  )
}
