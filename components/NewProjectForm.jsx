'use client'

import { useState, useEffect } from "react"

// ─── Design tokens (mirror do Dashboard) ──────────────────────────────────────

const T = {
  bg0: "#080808", bg1: "#0f0f0f", bg2: "#141414", bg3: "#1c1c1c",
  border: "#222222", border2: "#2a2a2a",
  text0: "#f1f5f9", text1: "#94a3b8", text2: "#475569",
  violet: "#a78bfa", blue: "#60a5fa", green: "#34d399",
  amber: "#fbbf24", red: "#f87171",
}
const mono = { fontFamily: "'JetBrains Mono','Fira Code','Courier New',monospace" }

// ─── Templates de briefing ─────────────────────────────────────────────────────
// Atalhos que preenchem o textarea com uma estrutura sugerida —
// reduz a fricção de "folha em branco" e ensina o formato esperado.

const BRIEFING_TEMPLATES = [
  {
    id: "landing",
    label: "Landing Page",
    icon: "🎯",
    template: `Objetivo: Landing page para [produto/serviço] com foco em conversão.

Público-alvo: [descreva o público]

Funcionalidades:
- Hero section com CTA principal
- Seção de benefícios/features
- Depoimentos ou prova social
- Formulário de captura de lead
- Footer com contato

Stack preferida: Next.js + Tailwind
Integrações: [ex: formulário → Supabase, analytics]
Tom visual: [ex: minimalista, corporativo, vibrante]`
  },
  {
    id: "api",
    label: "API REST",
    icon: "⚙️",
    template: `Objetivo: API REST para [domínio do negócio]

Entidades principais:
- [Entidade 1]: campos e relações
- [Entidade 2]: campos e relações

Endpoints necessários:
- CRUD completo para [entidades]
- [Endpoints customizados/regras de negócio]

Autenticação: [JWT / OAuth / API Key]
Stack: Node.js + TypeScript + [banco de dados]
Requisitos não-funcionais: [rate limiting, cache, etc]`
  },
  {
    id: "dashboard",
    label: "Dashboard",
    icon: "📊",
    template: `Objetivo: Dashboard para visualização de [tipo de dado]

Fonte de dados: [API existente / banco de dados / upload manual]

Visualizações necessárias:
- [Gráfico/métrica 1]
- [Gráfico/métrica 2]
- Filtros: [período, categoria, etc]

Usuários: [quem vai usar e seu nível técnico]
Stack preferida: React + Recharts
Atualização de dados: [tempo real / refresh manual / agendado]`
  },
  {
    id: "blog",
    label: "Blog / CMS",
    icon: "📝",
    template: `Objetivo: Blog/site de conteúdo para [tema/nicho]

Estrutura de conteúdo:
- Posts com [categorias, tags, autor]
- Páginas estáticas: [sobre, contato, etc]
- Comentários: [sim/não, moderação]

Fonte do conteúdo: [CMS headless / Markdown / banco de dados]
SEO: [meta tags dinâmicas, sitemap, schema.org necessário]
Stack preferida: Next.js (SSG/ISR) + [CMS]
Newsletter/captura de email: [sim/não]`
  },
  {
    id: "ecommerce",
    label: "E-commerce",
    icon: "🛒",
    template: `Objetivo: Loja virtual para [tipo de produto]

Catálogo:
- [Número aproximado de produtos/categorias]
- Variações: [tamanho, cor, etc]
- Estoque: [controle necessário?]

Checkout e pagamento:
- Gateway: [Stripe / Mercado Pago / PagSeguro]
- Frete: [cálculo automático / tabela fixa]

Funcionalidades: [carrinho, wishlist, cupons, avaliações]
Autenticação: [guest checkout / conta obrigatória]
Stack preferida: Next.js + [gateway] + [banco de dados]`
  },
  {
    id: "saas",
    label: "SaaS / App Web",
    icon: "🚀",
    template: `Objetivo: Aplicação SaaS para [problema que resolve]

Modelo de negócio: [free trial / freemium / assinatura]
Planos: [descreva os tiers, se houver]

Funcionalidades core:
- [Funcionalidade principal 1]
- [Funcionalidade principal 2]

Multi-tenancy: [cada usuário/empresa isolado? como?]
Autenticação: [email/senha, OAuth, SSO]
Cobrança: [Stripe Billing / outro]
Stack preferida: Next.js + Supabase/Postgres + [gateway de pagamento]`
  },
  {
    id: "internal_tool",
    label: "Ferramenta Interna",
    icon: "🔧",
    template: `Objetivo: Ferramenta interna para [equipe/processo]

Problema atual: [o que é feito manualmente hoje]

Funcionalidades:
- [Ação/fluxo 1]
- [Ação/fluxo 2]

Usuários: [quantas pessoas, quais papéis/permissões]
Integrações: [planilhas, Slack, banco de dados existente]
Stack preferida: React + Node.js + [banco de dados]
Hospedagem: [interna/VPN apenas ou acesso externo]`
  },
  {
    id: "mobile_backend",
    label: "Backend Mobile",
    icon: "📱",
    template: `Objetivo: Backend/API para app mobile de [funcionalidade]

Plataforma do app: [iOS / Android / cross-platform]

Funcionalidades que o backend precisa suportar:
- [Funcionalidade 1]
- [Funcionalidade 2]

Autenticação: [social login, telefone/SMS, email]
Notificações push: [sim/não, via qual serviço]
Upload de mídia: [imagens, vídeos — onde armazenar]
Stack preferida: Node.js + [banco de dados] + [storage]`
  },
  {
    id: "blank",
    label: "Em branco",
    icon: "✏️",
    template: ""
  },
]

// ─── Stage preview (mostra o que vai ser executado) ───────────────────────────

const STAGE_CODEBASE_ANALYSIS = { label: "Code Analysis", icon: "🔍", color: "#22d3ee" }

const STAGES_PREVIEW = [
  { label: "Planning",  icon: "📋", color: "#a78bfa" },
  { label: "Docs",      icon: "📄", color: "#60a5fa" },
  { label: "Design",    icon: "🎨", color: "#f472b6" },
  { label: "Backend",   icon: "⚙️",  color: "#34d399" },
  { label: "Frontend",  icon: "🖥️",  color: "#fbbf24" },
  { label: "Tests",     icon: "🧪", color: "#fb923c" },
  { label: "Quality",   icon: "🛡️",  color: "#e879f9" },
  { label: "Docs Final",icon: "📚", color: "#94a3b8" },
]

// ─── Componentes auxiliares ───────────────────────────────────────────────────

function FieldLabel({ children, hint }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ ...mono, fontSize: 10, letterSpacing: 1, color: T.text2, textTransform: "uppercase" }}>
        {children}
      </div>
      {hint && <div style={{ fontSize: 11, color: T.text2, marginTop: 2 }}>{hint}</div>}
    </div>
  )
}

function SegmentedControl({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 2, background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 8, padding: 3 }}>
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            ...mono, fontSize: 11, padding: "6px 12px", borderRadius: 6, border: "none",
            background: value === opt.value ? T.violet : "transparent",
            color: value === opt.value ? "#fff" : T.text2,
            cursor: "pointer", flex: 1,
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function NewProjectForm({ onSubmit, onCancel }) {
  const [projectName, setProjectName] = useState("")
  const [briefing,    setBriefing]    = useState("")
  const [activeTemplate, setActiveTemplate] = useState(null)

  // ── Origem do projeto: novo (briefing) vs repositório existente (GitHub) ──
  const [projectSource, setProjectSource] = useState("new") // 'new' | 'existing'
  const [githubConnected, setGithubConnected] = useState(null) // null=carregando, true/false
  const [repos,        setRepos]        = useState([])
  const [reposLoading, setReposLoading] = useState(false)
  const [repoSearch,   setRepoSearch]   = useState("")
  const [selectedRepo, setSelectedRepo] = useState(null) // { owner, repo, fullName, defaultBranch }

  // Config avançada
  const [selectorMode,   setSelectorMode]   = useState("auto")
  const [preferFreeTier, setPreferFreeTier] = useState(false)
  const [maxIterations,  setMaxIterations]  = useState(3)
  const [budgetUsd,      setBudgetUsd]      = useState("")
  const [showAdvanced,   setShowAdvanced]   = useState(false)

  const charCount   = briefing.length
  const wordCount   = briefing.trim() ? briefing.trim().split(/\s+/).length : 0

  const isValid = projectSource === "new"
    ? projectName.trim().length > 2 && briefing.trim().length > 20
    : projectName.trim().length > 2 && Boolean(selectedRepo)

  // Estimativa simples baseada no tamanho do briefing —
  // dá ao usuário uma noção de custo ANTES de rodar
  const estimatedCost = (0.008 + Math.min(briefing.length / 50000, 0.03)).toFixed(4)

  // Carrega repos do usuário quando troca para "Repositório existente"
  useEffect(() => {
    if (projectSource !== "existing" || repos.length > 0 || reposLoading) return
    setReposLoading(true)
    fetch("/api/github/repos")
      .then(r => r.json())
      .then(data => {
        setGithubConnected(Boolean(data.connected))
        setRepos(data.repos ?? [])
      })
      .catch(() => {
        // Sem backend disponível (ex: preview isolado) — mostra estado "não conectado"
        setGithubConnected(false)
        setRepos([])
      })
      .finally(() => setReposLoading(false))
    // repos.length/reposLoading ficam de fora de propósito: são o próprio
    // guard-clause do efeito — incluí-los causaria um loop de refetch toda
    // vez que a busca falhasse e zerasse repos/reposLoading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSource])

  const filteredRepos = repoSearch.trim()
    ? repos.filter(r => r.fullName.toLowerCase().includes(repoSearch.toLowerCase()))
    : repos

  function applyTemplate(tpl) {
    setActiveTemplate(tpl.id)
    setBriefing(tpl.template)
  }

  function handleSubmit() {
    if (!isValid) return
    onSubmit?.({
      projectName: projectName.trim(),
      briefing:    briefing.trim(),
      githubRepo:  projectSource === "existing" && selectedRepo
        ? { owner: selectedRepo.owner, repo: selectedRepo.repo, branch: selectedRepo.defaultBranch }
        : undefined,
      config: {
        selectorMode,
        preferFreeTier,
        maxIterationsPerStage: maxIterations,
        budgetUsd: budgetUsd ? parseFloat(budgetUsd) : undefined,
      },
    })
  }

  return (
    <div style={{ background: T.bg0, minHeight: "100vh", color: T.text0, fontFamily: "'Inter',-apple-system,sans-serif", padding: "20px 24px 60px", boxSizing: "border-box" }}>
      <style>{`
        * { box-sizing: border-box; }
        textarea:focus, input:focus { outline: none; border-color: ${T.violet} !important; }
        button { transition: all 0.15s; }
        input[type=range] { cursor: pointer; accent-color: ${T.violet}; }
        ::placeholder { color: #3a3a3a; }
      `}</style>

      <div style={{ maxWidth: 720, margin: "0 auto" }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <div style={{ width: 26, height: 26, background: `linear-gradient(135deg, ${T.violet}, ${T.blue})`, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>🏭</div>
            <span style={{ fontSize: 15, fontWeight: 700 }}>Novo Projeto</span>
          </div>
          <div style={{ ...mono, fontSize: 10, color: T.text2 }}>
            O briefing alimenta todas as 8 etapas da pipeline — quanto mais específico, melhor o resultado do Planning.
          </div>
        </div>

        {/* ── Nome do projeto ── */}
        <div style={{ marginBottom: 18 }}>
          <FieldLabel>Nome do projeto</FieldLabel>
          <input
            value={projectName}
            onChange={e => setProjectName(e.target.value)}
            placeholder="ex: LIV Incorporadora — Site Institucional"
            style={{
              width: "100%", background: T.bg1, border: `1px solid ${T.border}`,
              borderRadius: 8, padding: "10px 12px", color: T.text0, fontSize: 13,
            }}
          />
        </div>

        {/* ── Origem do projeto ── */}
        <div style={{ marginBottom: 18 }}>
          <FieldLabel hint="Repositório existente: o DevFactory lê a stack e convenções reais antes de planejar qualquer mudança.">
            Origem do projeto
          </FieldLabel>
          <div style={{ display: "flex", gap: 2, background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 8, padding: 3 }}>
            {[
              { id: "new",      label: "✏️ Novo projeto" },
              { id: "existing", label: "🔗 Repositório existente" },
            ].map(opt => (
              <button
                key={opt.id}
                onClick={() => setProjectSource(opt.id)}
                style={{
                  ...mono, fontSize: 11, padding: "8px 0", borderRadius: 6, border: "none",
                  background: projectSource === opt.id ? T.violet : "transparent",
                  color: projectSource === opt.id ? "#fff" : T.text2,
                  cursor: "pointer", flex: 1,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Modo: Repositório existente — picker do GitHub ── */}
        {projectSource === "existing" && (
          <div style={{ marginBottom: 20 }}>
            <FieldLabel>Repositório</FieldLabel>

            {githubConnected === false && (
              <div style={{ background: `${T.amber}10`, border: `1px solid ${T.amber}30`, borderRadius: 10, padding: 14 }}>
                <div style={{ fontSize: 12, color: T.text1, marginBottom: 10, lineHeight: 1.6 }}>
                  Sua conta do GitHub ainda não está conectada. Conecte para escolher um repositório existente.
                </div>
                <a
                  href="/api/github/connect"
                  style={{ ...mono, fontSize: 11, padding: "8px 14px", borderRadius: 8, background: T.violet, color: "#fff", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  ⚫ Conectar GitHub
                </a>
              </div>
            )}

            {githubConnected === null && (
              <div style={{ ...mono, fontSize: 11, color: T.text2, padding: "12px 0" }}>Verificando conexão com GitHub...</div>
            )}

            {githubConnected === true && (
              <div style={{ background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 10, padding: 12 }}>
                <input
                  value={repoSearch}
                  onChange={e => setRepoSearch(e.target.value)}
                  placeholder="Buscar repositório (ex: ghiberti85/interview-command-center)"
                  style={{ width: "100%", background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 6, padding: "8px 10px", color: T.text0, fontSize: 12, marginBottom: 10, boxSizing: "border-box" }}
                />

                {reposLoading && <div style={{ ...mono, fontSize: 11, color: T.text2 }}>Carregando repositórios...</div>}

                {!reposLoading && filteredRepos.length === 0 && (
                  <div style={{ ...mono, fontSize: 11, color: T.text2 }}>Nenhum repositório encontrado.</div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflowY: "auto" }}>
                  {filteredRepos.map(repo => {
                    const isSelected = selectedRepo?.fullName === repo.fullName
                    return (
                      <button
                        key={repo.fullName}
                        onClick={() => setSelectedRepo(repo)}
                        style={{
                          textAlign: "left", display: "flex", alignItems: "center", gap: 8,
                          padding: "8px 10px", borderRadius: 6, cursor: "pointer",
                          border: `1px solid ${isSelected ? T.violet : T.border}`,
                          background: isSelected ? `${T.violet}10` : T.bg2,
                        }}
                      >
                        <span style={{ fontSize: 13 }}>{repo.private ? "🔒" : "📂"}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, color: isSelected ? T.violet : T.text0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {repo.fullName}
                          </div>
                          {repo.description && (
                            <div style={{ fontSize: 10, color: T.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {repo.description}
                            </div>
                          )}
                        </div>
                        {isSelected && <span style={{ color: T.violet, fontSize: 12 }}>✓</span>}
                      </button>
                    )
                  })}
                </div>

                {selectedRepo && (
                  <div style={{ ...mono, fontSize: 10, color: T.green, marginTop: 10 }}>
                    ✓ Branch padrão: {selectedRepo.defaultBranch}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Templates — só faz sentido para projeto novo ── */}
        {projectSource === "new" && (
        <div style={{ marginBottom: 12 }}>
          <FieldLabel hint="Atalhos que preenchem uma estrutura sugerida — você pode editar tudo depois.">
            Começar com um template
          </FieldLabel>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {BRIEFING_TEMPLATES.map(tpl => (
              <button
                key={tpl.id}
                onClick={() => applyTemplate(tpl)}
                style={{
                  ...mono, fontSize: 11, padding: "6px 12px", borderRadius: 6,
                  border: `1px solid ${activeTemplate === tpl.id ? T.violet : T.border}`,
                  background: activeTemplate === tpl.id ? `${T.violet}15` : T.bg1,
                  color: activeTemplate === tpl.id ? T.violet : T.text1,
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                }}
              >
                <span>{tpl.icon}</span>{tpl.label}
              </button>
            ))}
          </div>
        </div>
        )}

        {/* ── Briefing — obrigatório em projeto novo, opcional em repo existente ── */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 6 }}>
            <FieldLabel>
              {projectSource === "new" ? "Briefing do projeto" : "O que você quer melhorar (opcional)"}
            </FieldLabel>
            <span style={{ ...mono, fontSize: 10, color: charCount > 20 ? T.text2 : T.amber }}>
              {wordCount} palavras
            </span>
          </div>

          <textarea
            value={briefing}
            onChange={e => { setBriefing(e.target.value); setActiveTemplate(null) }}
            placeholder={projectSource === "new" ? `Descreva o que você quer construir. Quanto mais contexto, melhor:

• Objetivo do projeto e problema que resolve
• Funcionalidades principais esperadas
• Público-alvo / usuários
• Stack técnica preferida (ou deixe o Selector decidir)
• Integrações necessárias (pagamento, auth, APIs externas)
• Restrições (prazo, orçamento, compliance)
• Referências visuais ou de produtos similares` : `Opcional — o DevFactory já vai analisar o repositório sozinho (stack, convenções, lacunas de documentação) e sugerir melhorias.

Use este campo se você já sabe o que quer priorizar, por exemplo:
• "Foco em performance e acessibilidade"
• "Migrar de JavaScript para TypeScript"
• "Adicionar testes E2E para o fluxo de checkout"
• "Atualizar a documentação que está desatualizada"`}
            style={{
              width: "100%", minHeight: projectSource === "new" ? 240 : 140, background: T.bg1, border: `1px solid ${T.border}`,
              borderRadius: 10, padding: 14, color: T.text0, fontSize: 13, lineHeight: 1.7,
              resize: "vertical", fontFamily: "inherit",
            }}
          />

          {projectSource === "new" && briefing.trim().length > 0 && briefing.trim().length < 20 && (
            <div style={{ ...mono, fontSize: 10, color: T.amber, marginTop: 6 }}>
              ⚠ Briefing muito curto — o Planning vai gerar um PRD genérico. Adicione mais contexto.
            </div>
          )}
        </div>

        {/* ── Preview da pipeline ── */}
        <div style={{ marginBottom: 20, background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 10, padding: 16 }}>
          <FieldLabel hint="Seu briefing será processado nesta ordem. O Selector escolhe o modelo ideal para cada etapa automaticamente.">
            O que vai acontecer
          </FieldLabel>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {(projectSource === "existing" ? [STAGE_CODEBASE_ANALYSIS, ...STAGES_PREVIEW] : STAGES_PREVIEW).map((s, i, arr) => (
              <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{
                  ...mono, fontSize: 10, padding: "4px 9px", borderRadius: 6,
                  border: `1px solid ${s.color}30`, background: `${s.color}10`, color: s.color,
                  display: "flex", alignItems: "center", gap: 4,
                }}>
                  <span>{s.icon}</span>{s.label}
                </span>
                {i < arr.length - 1 && <span style={{ color: T.text2, fontSize: 10 }}>→</span>}
              </div>
            ))}
          </div>
          {projectSource === "existing" && (
            <div style={{ ...mono, fontSize: 10, color: "#22d3ee", marginTop: 8 }}>
              🔍 Code Analysis lê o repositório real antes de qualquer planejamento — stack, convenções e lacunas de docs.
            </div>
          )}
          <div style={{ ...mono, fontSize: 10, color: T.text2, marginTop: 10 }}>
            Você revisa e aprova (ou pede ajustes) ao final de cada etapa antes da próxima começar.
          </div>
        </div>

        {/* ── Configuração avançada (colapsável) ── */}
        <div style={{ marginBottom: 20 }}>
          <button
            onClick={() => setShowAdvanced(s => !s)}
            style={{
              ...mono, fontSize: 11, color: T.text1, background: "none", border: "none",
              cursor: "pointer", display: "flex", alignItems: "center", gap: 6, padding: 0,
            }}
          >
            <span style={{ transform: showAdvanced ? "rotate(90deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>▸</span>
            Configuração avançada
          </button>

          {showAdvanced && (
            <div style={{ marginTop: 14, background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>

              {/* Selector mode */}
              <div>
                <FieldLabel hint="Auto: o Selector escolhe tudo. Override: você pode fixar um modelo por etapa depois. Manual: você define antes de iniciar.">
                  Modo do Model Selector
                </FieldLabel>
                <SegmentedControl
                  value={selectorMode}
                  onChange={setSelectorMode}
                  options={[
                    { value: "auto",          label: "Auto"     },
                    { value: "auto_override", label: "Override" },
                    { value: "manual",        label: "Manual"   },
                  ]}
                />
              </div>

              {/* Free tier */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <FieldLabel hint="Restringe a modelos gratuitos (Gemini free tier, GLM-4.7-Flash, Ollama local). Reduz custo a quase zero, mas pode aumentar iterações.">
                  Priorizar apenas modelos gratuitos
                </FieldLabel>
                <button
                  onClick={() => setPreferFreeTier(v => !v)}
                  style={{
                    width: 40, height: 22, borderRadius: 99, border: "none", cursor: "pointer",
                    background: preferFreeTier ? T.green : T.bg3, position: "relative", flexShrink: 0,
                  }}
                >
                  <div style={{
                    width: 16, height: 16, borderRadius: "50%", background: "#fff",
                    position: "absolute", top: 3, left: preferFreeTier ? 21 : 3,
                    transition: "left 0.15s",
                  }} />
                </button>
              </div>

              {/* Max iterations */}
              <div>
                <FieldLabel hint="Quantas vezes uma etapa pode ser retentada antes de forçar revisão humana.">
                  Máximo de iterações por etapa: <span style={{ color: T.violet }}>{maxIterations}</span>
                </FieldLabel>
                <input type="range" min={1} max={5} value={maxIterations} onChange={e => setMaxIterations(+e.target.value)} style={{ width: "100%" }} />
              </div>

              {/* Budget */}
              <div>
                <FieldLabel hint="Opcional. Se o custo estimado de uma operação ultrapassar o restante do orçamento, o Selector é forçado a usar modelos mais baratos.">
                  Orçamento máximo do run (USD)
                </FieldLabel>
                <input
                  value={budgetUsd}
                  onChange={e => setBudgetUsd(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="ex: 0.50 (deixe vazio para ilimitado)"
                  style={{ width: "100%", background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 12px", color: T.text0, fontSize: 12, ...mono }}
                />
              </div>
            </div>
          )}
        </div>

        {/* ── Estimativa + ações ── */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 10, padding: 16,
          flexWrap: "wrap", gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 10, color: T.text2 }}>Custo estimado deste run</div>
            <div style={{ ...mono, fontSize: 18, fontWeight: 700, color: preferFreeTier ? T.green : T.violet }}>
              {preferFreeTier ? "~$0.0000" : `~$${estimatedCost}`}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            {onCancel && (
              <button
                onClick={onCancel}
                style={{ ...mono, fontSize: 12, padding: "10px 18px", borderRadius: 8, border: `1px solid ${T.border2}`, background: "transparent", color: T.text2, cursor: "pointer" }}
              >
                Cancelar
              </button>
            )}
            <button
              onClick={handleSubmit}
              disabled={!isValid}
              style={{
                ...mono, fontSize: 12, padding: "10px 22px", borderRadius: 8, border: "none",
                background: isValid ? T.violet : T.bg3,
                color: isValid ? "#fff" : T.text2,
                cursor: isValid ? "pointer" : "not-allowed",
                fontWeight: 600,
              }}
            >
              ▶ Iniciar Pipeline
            </button>
          </div>
        </div>

        {!isValid && (briefing.length > 0 || projectName.length > 0) && (
          <div style={{ ...mono, fontSize: 10, color: T.text2, marginTop: 8, textAlign: "right" }}>
            {projectName.trim().length <= 2 ? "Nome do projeto muito curto. " : ""}
            {projectSource === "new"
              ? (briefing.trim().length <= 20 ? "Briefing precisa de pelo menos 20 caracteres." : "")
              : (!selectedRepo ? "Selecione um repositório para continuar." : "")}
          </div>
        )}
      </div>
    </div>
  )
}
