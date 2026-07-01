'use client'

import { useState, useEffect, useCallback } from "react"
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis } from "recharts"

// ─── Mock data ────────────────────────────────────────────────────────────────

const STAGE_META = {
  planning:        { label: "Planning",   icon: "📋", color: "#a78bfa" },
  docs_initial:    { label: "Docs Init",  icon: "📄", color: "#60a5fa" },
  design:          { label: "Design",     icon: "🎨", color: "#f472b6" },
  backend:         { label: "Backend",    icon: "⚙️",  color: "#34d399" },
  frontend:        { label: "Frontend",   icon: "🖥️",  color: "#fbbf24" },
  tests:           { label: "Tests",      icon: "🧪", color: "#fb923c" },
  quality_council: { label: "Quality",    icon: "🛡️",  color: "#e879f9" },
  docs_final:      { label: "Docs Final", icon: "📚", color: "#94a3b8" },
}

const RUNS = [
  { id: "r1", name: "LIV Incorporadora Website", status: "completed", date: "2026-06-20", totalCost: 0.0312, stages: 8, approvalRate: 0.94 },
  { id: "r2", name: "DevInterviewLab v2",        status: "completed", date: "2026-06-24", totalCost: 0.0187, stages: 8, approvalRate: 0.88 },
  { id: "r3", name: "Philosophia Oriental API",  status: "completed", date: "2026-06-27", totalCost: 0.0089, stages: 6, approvalRate: 1.00 },
  { id: "r4", name: "Finanças do Casal PWA",     status: "running",   date: "2026-06-29", totalCost: 0.0041, stages: 3, approvalRate: null },
]

const COST_BY_STAGE = [
  { stage: "Planning", cost: 0.0048 }, { stage: "Docs",     cost: 0.0018 },
  { stage: "Design",   cost: 0.0021 }, { stage: "Backend",  cost: 0.0071 },
  { stage: "Frontend", cost: 0.0038 }, { stage: "Tests",    cost: 0.0009 },
  { stage: "Quality",  cost: 0.0024 }, { stage: "Docs F.",  cost: 0.0003 },
]

const MODEL_PERFORMANCE = [
  { model: "DeepSeek V4 Pro Max", provider: "deepseek", origin: "chinese",     tier: 3, calls: 47,  approvals: 44,  cost: 0.0312, avgLatency: 4200, score: 0.94, strengths: ["coding","security"] },
  { model: "Claude Opus 4.8",     provider: "anthropic",origin: "western",     tier: 3, calls: 31,  approvals: 30,  cost: 0.0187, avgLatency: 6800, score: 0.97, strengths: ["reasoning","security"] },
  { model: "Claude Sonnet 4.6",   provider: "anthropic",origin: "western",     tier: 2, calls: 58,  approvals: 52,  cost: 0.0089, avgLatency: 3100, score: 0.90, strengths: ["coding","creative"] },
  { model: "DeepSeek V4 Pro",     provider: "deepseek", origin: "chinese",     tier: 2, calls: 89,  approvals: 78,  cost: 0.0041, avgLatency: 2800, score: 0.88, strengths: ["coding","agentic"] },
  { model: "Qwen 3.6 Plus",       provider: "qwen",     origin: "chinese",     tier: 2, calls: 34,  approvals: 30,  cost: 0.0021, avgLatency: 2400, score: 0.88, strengths: ["agentic"] },
  { model: "Kimi K2.6",           provider: "moonshot", origin: "chinese",     tier: 2, calls: 22,  approvals: 19,  cost: 0.0015, avgLatency: 3300, score: 0.86, strengths: ["agentic"] },
  { model: "MiniMax M3",          provider: "minimax",  origin: "chinese",     tier: 2, calls: 41,  approvals: 35,  cost: 0.0008, avgLatency: 2200, score: 0.85, strengths: ["coding"] },
  { model: "DeepSeek V4 Flash",   provider: "deepseek", origin: "chinese",     tier: 1, calls: 112, approvals: 97,  cost: 0.0006, avgLatency: 980,  score: 0.87, strengths: ["coding"] },
  { model: "Gemini 2.5 Flash",    provider: "google",   origin: "western",     tier: 1, calls: 78,  approvals: 67,  cost: 0.0002, avgLatency: 840,  score: 0.86, strengths: ["analysis"] },
  { model: "Gemini Flash-Lite",   provider: "google",   origin: "western",     tier: 1, calls: 143, approvals: 122, cost: 0.0001, avgLatency: 620,  score: 0.85, strengths: ["analysis"] },
  { model: "GLM-4.7 Flash",       provider: "glm",      origin: "chinese",     tier: 1, calls: 89,  approvals: 74,  cost: 0,      avgLatency: 710,  score: 0.83, strengths: ["coding"] },
  { model: "Gemma 4 26B",         provider: "ollama",   origin: "open-source", tier: 1, calls: 67,  approvals: 55,  cost: 0,      avgLatency: 1840, score: 0.82, strengths: ["analysis"] },
]

const COST_TREND = [
  { run: "Run 1", cost: 0.0312 }, { run: "Run 2", cost: 0.0187 },
  { run: "Run 3", cost: 0.0089 }, { run: "Run 4", cost: 0.0041 },
]

const TIER_DISTRIBUTION = [
  { tier: "Tier 1 — free/cheap", calls: 489, pct: 54 },
  { tier: "Tier 2 — mid",        calls: 244, pct: 27 },
  { tier: "Tier 3 — frontier",   calls: 175, pct: 19 },
]

const QUALITY_RADAR = [
  { dimension: "Security", score: 91 }, { dimension: "Performance", score: 87 },
  { dimension: "SEO",      score: 95 }, { dimension: "A11y",        score: 83 },
  { dimension: "Best Practices", score: 89 },
]

const ORIGIN_SPLIT = [
  { origin: "Chinese",     pct: 58, color: "#e879f9", cost: "$0.0028" },
  { origin: "Western",     pct: 31, color: "#60a5fa", cost: "$0.0178" },
  { origin: "Open-source", pct: 11, color: "#34d399", cost: "$0.0000" },
]

const LEARNING_EVENTS = [
  { run: 1, event: "Selector usa heurística — sem histórico",                 tier: null, impact: "neutro"   },
  { run: 1, event: "Claude Opus 4.8 → Planning: 100% aprovação",             tier: "T3", impact: "positivo" },
  { run: 1, event: "DeepSeek V4 Flash → Tests: aprovado em 1ª iteração",     tier: "T1", impact: "positivo" },
  { run: 2, event: "Selector pondera histórico: Opus priorizado em Planning", tier: "T3", impact: "neutro"   },
  { run: 2, event: "GLM-4.7-Flash substituído em backend (score 0.62)",       tier: "T1", impact: "escalado" },
  { run: 3, event: "Gemini Flash-Lite → Docs Final: 3 runs 100% aprovação",  tier: "T1", impact: "positivo" },
  { run: 3, event: "DeepSeek V4 Pro Max favorito empírico em Backend T3",     tier: "T3", impact: "positivo" },
  { run: 4, event: "Custo médio reduzido 87% vs Run 1",                       tier: null, impact: "ganho"    },
]

// ─── Info content ─────────────────────────────────────────────────────────────
// Cada chave mapeia para o conteúdo do modal de ajuda

const INFO = {
  pipeline_runs: {
    title: "Pipeline Runs",
    icon: "🏭",
    sections: [
      {
        heading: "O que é um Run?",
        body: "Um Run é uma execução completa da pipeline do DevFactory para um projeto. Cada run passa por até 8 etapas sequenciais: Planejamento → Docs → Design → Backend → Frontend → Testes → Quality Council → Docs Final."
      },
      {
        heading: "Status possíveis",
        body: "• running — pipeline em execução\n• completed — todas as etapas aprovadas\n• failed — uma etapa falhou após esgotar tentativas\n• cancelled — cancelado manualmente"
      },
      {
        heading: "Gate humano",
        body: "Ao final de cada etapa, você revisa o output do agente e decide: aprovar, editar diretamente, ou rejeitar com feedback. O feedback é injetado como contexto na próxima tentativa."
      }
    ]
  },
  total_cost: {
    title: "Custo Total em LLMs",
    icon: "💰",
    sections: [
      {
        heading: "Como é calculado?",
        body: "Soma de todas as chamadas de modelo em todos os runs: (tokens_input / 1M × preço_input) + (tokens_output / 1M × preço_output). Chamadas gratuitas (Gemini Flash free tier, GLM-4.7-Flash, Ollama) contribuem $0.00."
      },
      {
        heading: "Por que tão baixo?",
        body: "O Complexity Router avalia cada operação e escolhe o menor tier suficiente. Operações simples (boilerplate, docs, SEO) usam modelos gratuitos. Apenas decisões críticas (auth, arquitetura) sobem para Tier 3."
      },
      {
        heading: "Comparação",
        body: "Usando Claude Opus 4.8 em todas as operações, o mesmo volume custaria ~$4.20. O DevFactory reduz isso para ~$0.06 por arbitragem de modelo — sem perder qualidade nas decisões críticas."
      }
    ]
  },
  total_calls: {
    title: "Chamadas de Modelo",
    icon: "📡",
    sections: [
      {
        heading: "O que conta como chamada?",
        body: "Cada chamada ao modelo registrada: execução de agente, auto-crítica, e classificação do Complexity Router. Uma etapa com 2 iterações gera pelo menos 4 chamadas (2 execuções + 2 auto-críticas)."
      },
      {
        heading: "Chamadas gratuitas",
        body: "54% das chamadas usam modelos com free tier (Gemini Flash, Flash-Lite) ou locais (Gemma 4 via Ollama) ou modelos chineses sem custo (GLM-4.7-Flash). O Complexity Router em si usa sempre modelos gratuitos."
      }
    ]
  },
  approval_rate: {
    title: "Taxa de Aprovação Humana",
    icon: "✅",
    sections: [
      {
        heading: "Como é calculada?",
        body: "Proporção de iterações aprovadas ou aprovadas-com-edição pelo humano sobre o total de iterações que chegaram ao gate. Score composto: 60% aprovação humana + 30% auto-crítica + 10% custo."
      },
      {
        heading: "Impacto no sistema",
        body: "O Model Performance History atualiza o score de cada modelo após cada gate. Com o tempo, o Selector passa a preferir empiricamente modelos com maior taxa de aprovação para cada etapa específica."
      },
      {
        heading: "Por que melhorou?",
        body: "O Selector aprendeu a evitar modelos que tiveram auto-crítica < 0.70 em etapas críticas, escalando para tier superior antes mesmo do gate humano. Isso reduziu rejeições de 18% (run 1) para 6% (run 4)."
      }
    ]
  },
  tier_distribution: {
    title: "Distribuição de Tier",
    icon: "🎯",
    sections: [
      {
        heading: "O que é Tier?",
        body: "Classificação de complexidade atribuída pelo Complexity Router a cada operação:\n• Tier 1 — simples, previsível, boilerplate. Modelos grátis ou baratos.\n• Tier 2 — feature dev padrão, lógica moderada. Modelos mid-tier.\n• Tier 3 — decisão crítica, segurança, arquitetura. Modelos frontier."
      },
      {
        heading: "Como é determinado?",
        body: "O Router avalia 3 dimensões (0-1 cada):\n• Ambiguidade (peso 35%) — quão vaga é a spec\n• Criticidade (peso 45%) — impacto de um erro\n• Novidade (peso 20%) — se existe padrão no codebase\n\nScore < 0.30 → T1 · < 0.60 → T2 · ≥ 0.60 → T3"
      },
      {
        heading: "Exceção absoluta",
        body: "Se criticidade ≥ 0.85, o tier é sempre 3 — independente do score final. Operações de auth, schema de banco, security review e decisões arquiteturais entram aqui automaticamente."
      }
    ]
  },
  model_performance: {
    title: "Performance dos Modelos",
    icon: "📊",
    sections: [
      {
        heading: "O que é o Score?",
        body: "Score composto calculado após cada gate humano:\n• 60% × taxa de aprovação humana\n• 30% × score médio de auto-crítica (0-1)\n• 10% × eficiência de custo normalizada\n\nVaria de 0 a 1. Modelos com score > 0.85 são considerados excelentes."
      },
      {
        heading: "Como o Selector usa isso?",
        body: "Para cada operação, o Selector pontua os candidatos cruzando: tier compatibility, força (coding/reasoning/security/etc), score histórico nessa etapa, e custo. O modelo com maior score ponderado é selecionado."
      },
      {
        heading: "Progressive Escalation",
        body: "Se a auto-crítica retornar score < 0.70, o sistema automaticamente repete a operação com um tier superior antes de ir para o gate humano. Isso reduz rejeições humanas sem aumentar custo médio de forma significativa."
      }
    ]
  },
  quality_council: {
    title: "Quality Council",
    icon: "🛡️",
    sections: [
      {
        heading: "O que é?",
        body: "Uma etapa especial que roda 5 análises em paralelo antes da entrega final: Segurança (OWASP, Semgrep), Performance (Lighthouse), SEO (Lighthouse), Acessibilidade (axe-core) e Boas Práticas (ESLint)."
      },
      {
        heading: "Modelos por dimensão",
        body: "Cada dimensão usa um tier e modelo diferente:\n• Segurança → Tier 3 (Claude Opus ou DeepSeek Pro Max)\n• Performance / A11y → Tier 2\n• SEO / Boas Práticas → Tier 1 (frequentemente gratuito)"
      },
      {
        heading: "Veredito",
        body: "pass — score ≥ 80, sem issues de alta severidade\nwarn — score 60-79, issues moderados\nfail — score < 60 ou issue crítico\n\nSe qualquer dimensão retornar fail, a etapa vai para gate humano com relatório detalhado antes de prosseguir."
      }
    ]
  },
  learning_loop: {
    title: "Learning Loop",
    icon: "🧠",
    sections: [
      {
        heading: "Como o sistema aprende?",
        body: "Após cada gate humano, o Model Performance History é atualizado com: aprovação/rejeição, score de auto-crítica, custo real e latência. O score composto de cada modelo por etapa é recalculado com rolling average."
      },
      {
        heading: "Quando entra em ação?",
        body: "A partir do run 2, o Selector começa a ponderar o histórico. Com mais de 5 chamadas por modelo/etapa, o histórico tem peso maior que a heurística inicial. O sistema essencialmente descobre empiricamente o melhor modelo para cada tarefa específica."
      },
      {
        heading: "Resultado prático",
        body: "Em 4 runs, o custo médio caiu 87% sem redução na taxa de aprovação humana. O sistema descobriu que DeepSeek V4 Flash é suficiente para Tests e Docs, reservando Opus apenas para Planning e Security — exatamente onde faz diferença."
      }
    ]
  },
  savings: {
    title: "Calculadora de Economia",
    icon: "📈",
    sections: [
      {
        heading: "Base de comparação",
        body: "Compara o custo real do DevFactory ($0.0157/run em média) contra usar Claude Opus 4.8 para todas as operações (estimativa de $0.42/run baseada no volume de tokens médio observado)."
      },
      {
        heading: "Por que a diferença é tão grande?",
        body: "O Opus custa $5/$25 por 1M tokens. O DeepSeek V4 Flash custa $0.14/$0.28. Para operações de Tier 1 (54% do volume), essa diferença é de ~89x. Multiplicada por centenas de chamadas, o impacto é enorme."
      },
      {
        heading: "Limitações da estimativa",
        body: "Projetos com alta complexidade ou muitas iterações humanas terão custo maior. A calculadora usa a média atual de 4 runs, que inclui projetos relativamente simples. Projetos com muita lógica de negócio nova tendem a ter mais operações de Tier 3."
      }
    ]
  }
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const T = {
  bg0: "#080808", bg1: "#0f0f0f", bg2: "#141414", bg3: "#1c1c1c",
  border: "#222222", border2: "#2a2a2a",
  text0: "#f1f5f9", text1: "#94a3b8", text2: "#475569",
  violet: "#a78bfa", blue: "#60a5fa", green: "#34d399",
  amber: "#fbbf24", pink: "#f472b6", red: "#f87171", orange: "#fb923c",
}
const mono = { fontFamily: "'JetBrains Mono','Fira Code','Courier New',monospace" }
const TIER_COLOR = { 1: T.green, 2: T.amber, 3: T.violet }

// ─── useBreakpoint ────────────────────────────────────────────────────────────

function useBreakpoint() {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 900)
  useEffect(() => {
    const h = () => setW(window.innerWidth)
    window.addEventListener("resize", h)
    return () => window.removeEventListener("resize", h)
  }, [])
  return { isMobile: w < 600, isTablet: w < 900 }
}

// ─── Info Modal ───────────────────────────────────────────────────────────────

function InfoModal({ infoKey, onClose }) {
  const info = INFO[infoKey]
  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  }, [onClose])

  if (!info) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.75)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16,
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: T.bg1,
          border: `1px solid ${T.border2}`,
          borderRadius: 14,
          padding: 24,
          maxWidth: 480,
          width: "100%",
          maxHeight: "85vh",
          overflowY: "auto",
          position: "relative",
          boxShadow: `0 0 0 1px ${T.violet}20, 0 24px 64px rgba(0,0,0,0.6)`,
        }}
      >
        {/* Close */}
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: 14, right: 14,
            background: T.bg3, border: `1px solid ${T.border}`,
            color: T.text2, borderRadius: 6, width: 28, height: 28,
            cursor: "pointer", fontSize: 14, display: "flex",
            alignItems: "center", justifyContent: "center", padding: 0,
          }}
        >
          ✕
        </button>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: `${T.violet}18`, border: `1px solid ${T.violet}30`,
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
          }}>
            {info.icon}
          </div>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: T.text0 }}>{info.title}</h2>
        </div>

        {/* Sections */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {info.sections.map((s, i) => (
            <div key={i}>
              <div style={{
                ...mono, fontSize: 10, color: T.violet,
                letterSpacing: 1, textTransform: "uppercase", marginBottom: 6,
              }}>
                {s.heading}
              </div>
              <div style={{
                fontSize: 12, color: T.text1, lineHeight: 1.7,
                whiteSpace: "pre-line",
                background: T.bg2, borderRadius: 8,
                padding: "10px 12px",
                borderLeft: `3px solid ${T.violet}40`,
              }}>
                {s.body}
              </div>
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div style={{ ...mono, fontSize: 9, color: T.text2, marginTop: 20, textAlign: "center" }}>
          Clique fora ou pressione ESC para fechar
        </div>
      </div>
    </div>
  )
}

// ─── InfoButton ───────────────────────────────────────────────────────────────

function InfoBtn({ infoKey, onOpen }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onOpen(infoKey) }}
      title="Mais informações"
      style={{
        background: "transparent",
        border: `1px solid ${T.border2}`,
        color: T.text2,
        borderRadius: "50%",
        width: 18, height: 18,
        fontSize: 10, cursor: "pointer",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        padding: 0, flexShrink: 0,
        lineHeight: 1,
        transition: "all 0.15s",
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = T.violet; e.currentTarget.style.color = T.violet }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = T.border2; e.currentTarget.style.color = T.text2 }}
    >
      i
    </button>
  )
}

// ─── Label with info ──────────────────────────────────────────────────────────

function Label({ children, infoKey, onInfo, style = {} }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10, ...style }}>
      <span style={{ ...mono, fontSize: 10, letterSpacing: 1.5, color: T.text2, textTransform: "uppercase" }}>
        {children}
      </span>
      {infoKey && onInfo && <InfoBtn infoKey={infoKey} onOpen={onInfo} />}
    </div>
  )
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function Card({ children, style = {} }) {
  return (
    <div style={{ background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 10, padding: 16, ...style }}>
      {children}
    </div>
  )
}

function ScoreBar({ score, color = T.violet, height = 4 }) {
  return (
    <div style={{ background: T.bg3, borderRadius: 99, height, overflow: "hidden", flex: 1 }}>
      <div style={{ width: `${score * 100}%`, height: "100%", background: color, borderRadius: 99, transition: "width 0.5s ease" }} />
    </div>
  )
}

function TierDot({ tier }) {
  return <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: TIER_COLOR[tier] ?? T.text2, marginRight: 5, flexShrink: 0 }} />
}

function OriginBadge({ origin }) {
  const colors = { chinese: "#e879f9", western: "#60a5fa", "open-source": "#34d399" }
  const c = colors[origin] ?? T.text2
  return (
    <span style={{ ...mono, fontSize: 9, color: c, background: `${c}15`, border: `1px solid ${c}30`, borderRadius: 3, padding: "1px 5px", whiteSpace: "nowrap" }}>
      {origin}
    </span>
  )
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: T.bg2, border: `1px solid ${T.border2}`, borderRadius: 6, padding: "8px 12px", ...mono, fontSize: 11, color: T.text0 }}>
      <div style={{ color: T.text1, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color ?? T.violet }}>
          {p.name}: {typeof p.value === "number" ? `$${p.value.toFixed(4)}` : p.value}
        </div>
      ))}
    </div>
  )
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function SummaryRow({ isMobile, onInfo }) {
  const totalCost   = RUNS.reduce((s, r) => s + r.totalCost, 0)
  const totalCalls  = MODEL_PERFORMANCE.reduce((s, m) => s + m.calls, 0)
  const avgApproval = MODEL_PERFORMANCE.reduce((s, m) => s + m.approvals / m.calls, 0) / MODEL_PERFORMANCE.length

  const stats = [
    { value: RUNS.length,                          label: "Pipeline runs",  sub: "3 done · 1 running",    color: T.violet, key: "pipeline_runs" },
    { value: `$${totalCost.toFixed(4)}`,           label: "Total em LLMs", sub: "vs $4.20 single-model",  color: T.green,  key: "total_cost"    },
    { value: totalCalls,                           label: "Chamadas",       sub: "54% gratuitas",          color: T.blue,   key: "total_calls"   },
    { value: `${(avgApproval * 100).toFixed(0)}%`, label: "Aprovação",     sub: "↑ 6pp desde run 1",     color: T.amber,  key: "approval_rate" },
  ]

  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 10, marginBottom: 14 }}>
      {stats.map((s, i) => (
        <Card key={i} style={{ padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
            <div style={{ ...mono, fontSize: isMobile ? 18 : 22, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.value}</div>
            <InfoBtn infoKey={s.key} onOpen={onInfo} />
          </div>
          <div style={{ fontSize: 11, color: T.text2 }}>{s.label}</div>
          <div style={{ ...mono, fontSize: 9, color: T.text2, marginTop: 3 }}>{s.sub}</div>
        </Card>
      ))}
    </div>
  )
}

function RunsList({ onSelect, selected, onInfo }) {
  return (
    <Card>
      <Label infoKey="pipeline_runs" onInfo={onInfo}>Runs recentes</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {RUNS.map(run => {
          const isActive = selected === run.id
          const statusColor = run.status === "completed" ? T.green : T.amber
          return (
            <div key={run.id} onClick={() => onSelect(run.id === selected ? null : run.id)} style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${isActive ? T.violet + "50" : T.border}`, background: isActive ? `${T.violet}08` : T.bg2, cursor: "pointer", transition: "all 0.15s" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12, color: isActive ? T.violet : T.text0, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{run.name}</span>
                <span style={{ ...mono, fontSize: 10, color: statusColor, whiteSpace: "nowrap", flexShrink: 0 }}>{run.status === "running" ? "◉ running" : "✓ done"}</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 6 }}>
                <span style={{ ...mono, fontSize: 10, color: T.text2 }}>{run.date}</span>
                <span style={{ ...mono, fontSize: 10, color: T.green }}>${run.totalCost.toFixed(4)}</span>
                <span style={{ ...mono, fontSize: 10, color: T.text2 }}>{run.stages}/8 etapas</span>
                {run.approvalRate !== null && <span style={{ ...mono, fontSize: 10, color: run.approvalRate >= 0.9 ? T.green : T.amber }}>{(run.approvalRate * 100).toFixed(0)}% aprovação</span>}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function CostByStageChart({ onInfo }) {
  return (
    <Card>
      <Label infoKey="total_cost" onInfo={onInfo}>Custo por etapa</Label>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={COST_BY_STAGE} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
          <XAxis dataKey="stage" tick={{ ...mono, fontSize: 8, fill: T.text2 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ ...mono, fontSize: 8, fill: T.text2 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(3)}`} />
          <Tooltip content={<CustomTooltip />} />
          <Bar dataKey="cost" radius={[4, 4, 0, 0]} name="cost">
            {COST_BY_STAGE.map((_, i) => <Cell key={i} fill={Object.values(STAGE_META)[i]?.color ?? T.violet} opacity={0.85} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Card>
  )
}

function CostTrendChart({ onInfo }) {
  return (
    <Card>
      <Label infoKey="learning_loop" onInfo={onInfo}>Custo por run</Label>
      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={COST_TREND} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
          <XAxis dataKey="run" tick={{ ...mono, fontSize: 8, fill: T.text2 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ ...mono, fontSize: 8, fill: T.text2 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(3)}`} />
          <Tooltip content={<CustomTooltip />} />
          <Line dataKey="cost" stroke={T.violet} strokeWidth={2} dot={{ fill: T.violet, r: 3 }} name="cost" />
        </LineChart>
      </ResponsiveContainer>
      <div style={{ ...mono, fontSize: 10, color: T.green, marginTop: 8 }}>↓ 87% de redução em 4 runs</div>
    </Card>
  )
}

function TierDistribution({ onInfo }) {
  return (
    <Card>
      <Label infoKey="tier_distribution" onInfo={onInfo}>Distribuição de tier & origem</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        {TIER_DISTRIBUTION.map((t, i) => {
          const colors = [T.green, T.amber, T.violet]
          return (
            <div key={i}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: T.text1 }}>{t.tier}</span>
                <span style={{ ...mono, fontSize: 10, color: colors[i] }}>{t.pct}% · {t.calls} calls</span>
              </div>
              <ScoreBar score={t.pct / 100} color={colors[i]} height={5} />
            </div>
          )
        })}
      </div>
      <div style={{ display: "flex", borderTop: `1px solid ${T.border}`, paddingTop: 14 }}>
        {ORIGIN_SPLIT.map(o => (
          <div key={o.origin} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ ...mono, fontSize: 20, fontWeight: 700, color: o.color }}>{o.pct}%</div>
            <div style={{ fontSize: 10, color: T.text2, marginTop: 2 }}>{o.origin}</div>
            <div style={{ ...mono, fontSize: 9, color: o.color }}>{o.cost}/call</div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function SavingsCalculator({ onInfo }) {
  const [runs, setRuns] = useState(10)
  const devCost  = (runs * 0.0157).toFixed(2)
  const opusCost = (runs * 0.42).toFixed(2)
  const saved    = (runs * (0.42 - 0.0157)).toFixed(2)
  const pct      = (((0.42 - 0.0157) / 0.42) * 100).toFixed(0)

  return (
    <Card>
      <Label infoKey="savings" onInfo={onInfo}>Calculadora de economia</Label>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: T.text2, marginBottom: 6 }}>Runs por mês: <span style={{ color: T.violet, ...mono }}>{runs}</span></div>
        <input type="range" min={1} max={50} value={runs} onChange={e => setRuns(+e.target.value)} style={{ width: "100%", accentColor: T.violet }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        {[
          { label: "DevFactory", value: `$${devCost}`,  color: T.green  },
          { label: "Single Opus",value: `$${opusCost}`, color: T.red    },
          { label: "Economia",   value: `$${saved}`,    color: T.violet, sub: `↓ ${pct}%` },
        ].map(s => (
          <div key={s.label} style={{ background: T.bg2, borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 10, color: T.text2, marginBottom: 4 }}>{s.label}</div>
            <div style={{ ...mono, fontSize: 16, fontWeight: 700, color: s.color }}>{s.value}</div>
            {s.sub && <div style={{ ...mono, fontSize: 10, color: s.color }}>{s.sub}</div>}
          </div>
        ))}
      </div>
    </Card>
  )
}

function ModelLeaderboard({ filterTier, setFilterTier, isMobile, onInfo }) {
  const filtered = filterTier ? MODEL_PERFORMANCE.filter(m => m.tier === filterTier) : MODEL_PERFORMANCE
  const sorted   = [...filtered].sort((a, b) => b.score - a.score)

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <Label infoKey="model_performance" onInfo={onInfo} style={{ marginBottom: 0 }}>Model performance</Label>
        <div style={{ display: "flex", gap: 4 }}>
          {[null, 1, 2, 3].map(t => (
            <button key={t ?? "all"} onClick={() => setFilterTier(t)} style={{ ...mono, fontSize: 10, padding: "3px 10px", borderRadius: 4, border: `1px solid ${t ? TIER_COLOR[t] : T.border2}`, background: filterTier === t ? (t ? `${TIER_COLOR[t]}18` : T.bg3) : "transparent", color: filterTier === t ? (t ? TIER_COLOR[t] : T.text0) : T.text2, cursor: "pointer" }}>
              {t === null ? "All" : `T${t}`}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(300px, 1fr))", gap: 8 }}>
        {sorted.map((m, i) => {
          const approvalPct = ((m.approvals / m.calls) * 100).toFixed(0)
          const isFree = m.cost === 0
          return (
            <div key={m.model} style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 8, padding: 12, position: "relative" }}>
              <div style={{ ...mono, fontSize: 9, color: T.text2, position: "absolute", top: 10, right: 10 }}>#{i + 1}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap", paddingRight: 24 }}>
                <TierDot tier={m.tier} />
                <span style={{ fontSize: 11, color: T.text0, fontWeight: 600 }}>{m.model}</span>
                <OriginBadge origin={m.origin} />
                {isFree && <span style={{ ...mono, fontSize: 9, color: T.green, background: `${T.green}15`, border: `1px solid ${T.green}30`, borderRadius: 3, padding: "1px 5px" }}>FREE</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <ScoreBar score={m.score} color={TIER_COLOR[m.tier]} height={4} />
                <span style={{ ...mono, fontSize: 11, color: TIER_COLOR[m.tier], minWidth: 32 }}>{(m.score * 100).toFixed(0)}%</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                {[["Calls", m.calls], ["Approval", `${approvalPct}%`], ["Latency", `${(m.avgLatency/1000).toFixed(1)}s`], ["Cost/call", isFree ? "$0.00" : `$${(m.cost/m.calls).toFixed(5)}`], ["Provider", m.provider], ["Strength", m.strengths[0]]].map(([l, v]) => (
                  <div key={l}>
                    <div style={{ fontSize: 9, color: T.text2 }}>{l}</div>
                    <div style={{ ...mono, fontSize: 10, color: T.text1, marginTop: 1 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function QualityRadar({ onInfo }) {
  return (
    <Card>
      <Label infoKey="quality_council" onInfo={onInfo}>Quality Council — média acumulada</Label>
      <ResponsiveContainer width="100%" height={200}>
        <RadarChart data={QUALITY_RADAR} margin={{ top: 4, right: 20, bottom: 4, left: 20 }}>
          <PolarGrid stroke={T.border2} />
          <PolarAngleAxis dataKey="dimension" tick={{ ...mono, fontSize: 9, fill: T.text2 }} />
          <Radar dataKey="score" stroke={T.violet} fill={T.violet} fillOpacity={0.15} strokeWidth={2} />
          <Tooltip content={<CustomTooltip />} />
        </RadarChart>
      </ResponsiveContainer>
    </Card>
  )
}

function TopModelsMini({ onInfo }) {
  return (
    <Card>
      <Label infoKey="model_performance" onInfo={onInfo}>Top models por score</Label>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[...MODEL_PERFORMANCE].sort((a, b) => b.score - a.score).slice(0, 6).map(m => (
          <div key={m.model} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <TierDot tier={m.tier} />
            <span style={{ fontSize: 11, color: T.text1, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.model}</span>
            <ScoreBar score={m.score} color={TIER_COLOR[m.tier]} height={4} />
            <span style={{ ...mono, fontSize: 10, color: T.text2, minWidth: 28 }}>{(m.score * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </Card>
  )
}

function LearningLoop({ onInfo }) {
  const colors    = { positivo: T.green, escalado: T.amber, neutro: T.text2, ganho: T.violet }
  const icons     = { positivo: "✓", escalado: "↑", neutro: "·", ganho: "★" }
  const tierColors = { T1: T.green, T2: T.amber, T3: T.violet }

  return (
    <Card>
      <Label infoKey="learning_loop" onInfo={onInfo}>Learning loop — selector evoluindo</Label>
      <div style={{ position: "relative", paddingLeft: 20 }}>
        <div style={{ position: "absolute", left: 6, top: 0, bottom: 0, width: 1, background: T.border2 }} />
        {LEARNING_EVENTS.map((ev, i) => {
          const c = colors[ev.impact]
          return (
            <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "flex-start", position: "relative" }}>
              <div style={{ position: "absolute", left: -20, top: 4, width: 8, height: 8, borderRadius: "50%", background: c, border: `2px solid ${T.bg1}` }} />
              <span style={{ ...mono, fontSize: 10, color: T.text2, minWidth: 28, flexShrink: 0 }}>R{ev.run}</span>
              <span style={{ ...mono, fontSize: 10, color: c, minWidth: 10, flexShrink: 0 }}>{icons[ev.impact]}</span>
              <span style={{ fontSize: 11, color: T.text1, flex: 1, lineHeight: 1.5 }}>{ev.event}</span>
              {ev.tier && <span style={{ ...mono, fontSize: 9, color: tierColors[ev.tier], background: `${tierColors[ev.tier]}15`, border: `1px solid ${tierColors[ev.tier]}30`, borderRadius: 3, padding: "1px 5px", flexShrink: 0 }}>{ev.tier}</span>}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function OriginEvolution({ onInfo }) {
  return (
    <Card>
      <Label infoKey="learning_loop" onInfo={onInfo}>Distribuição de origem</Label>
      <p style={{ fontSize: 11, color: T.text1, marginTop: 0, marginBottom: 14, lineHeight: 1.6 }}>
        O Selector aprende a preferir modelos chineses para alto volume — reduzindo custo sem sacrificar aprovação.
      </p>
      {ORIGIN_SPLIT.map(o => (
        <div key={o.origin} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: T.text1, textTransform: "capitalize" }}>{o.origin}</span>
            <span style={{ ...mono, fontSize: 10, color: o.color }}>{o.pct}% · {o.cost}/call</span>
          </div>
          <ScoreBar score={o.pct / 100} color={o.color} height={5} />
        </div>
      ))}
    </Card>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

/**
 * @param {{ onNewProject?: () => void }} props
 */
export default function Dashboard({ onNewProject } = {}) {
  const { isMobile, isTablet } = useBreakpoint()
  const [selectedRun, setSelectedRun] = useState(null)
  const [filterTier,  setFilterTier]  = useState(null)
  const [activeTab,   setActiveTab]   = useState("overview")
  const [activeInfo,  setActiveInfo]  = useState(null)

  const openInfo  = useCallback((key) => setActiveInfo(key), [])
  const closeInfo = useCallback(() => setActiveInfo(null), [])

  const grid2 = { display: "grid", gridTemplateColumns: isTablet ? "1fr" : "1fr 1fr", gap: 12 }

  return (
    <div style={{ background: T.bg0, minHeight: "100vh", color: T.text0, fontFamily: "'Inter',-apple-system,sans-serif", padding: isMobile ? "14px 12px 90px" : "20px 24px 40px", boxSizing: "border-box" }}>
      <style>{`
        * { box-sizing: border-box; }
        button { transition: all 0.15s; }
        input[type=range] { cursor: pointer; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: #0d0d0d; }
        ::-webkit-scrollbar-thumb { background: #2d2d2d; border-radius: 2px; }
      `}</style>

      {/* ── Info Modal ── */}
      {activeInfo && <InfoModal infoKey={activeInfo} onClose={closeInfo} />}

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: isMobile ? "flex-start" : "center", justifyContent: "space-between", flexDirection: isMobile ? "column" : "row", gap: 12, marginBottom: 20 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 26, height: 26, background: `linear-gradient(135deg, ${T.violet}, ${T.blue})`, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>🏭</div>
            <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: -0.5 }}>DevFactory</span>
            <span style={{ ...mono, fontSize: 9, color: T.text2, background: T.bg3, border: `1px solid ${T.border}`, borderRadius: 4, padding: "2px 6px" }}>v0.1.0</span>
          </div>
          <div style={{ ...mono, fontSize: 9, color: T.text2, marginTop: 3 }}>Autonomous Software Factory — Observability</div>
        </div>

        {/* Desktop: botão + tabs lado a lado. Mobile: só os tabs (botão vira FAB). */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", alignSelf: isMobile ? "stretch" : "auto" }}>
          {!isMobile && (
            <button
              onClick={onNewProject}
              style={{
                ...mono, fontSize: 11, padding: "8px 14px", borderRadius: 8,
                border: "none", background: T.violet, color: "#fff", fontWeight: 600,
                cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                whiteSpace: "nowrap",
              }}
            >
              <span>➕</span> Novo Projeto
            </button>
          )}
          <div style={{ display: "flex", gap: 2, background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 8, padding: 3, flex: isMobile ? 1 : "none" }}>
            {[{id:"overview",label:"Overview"},{id:"models",label:"Models"},{id:"learning",label:"Learning"}].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ ...mono, fontSize: 11, padding: "5px 0", borderRadius: 6, border: "none", background: activeTab === t.id ? T.violet : "transparent", color: activeTab === t.id ? "#fff" : T.text2, cursor: "pointer", flex: 1 }}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Mobile: Floating Action Button para Novo Projeto — não disputa espaço com os tabs */}
      {isMobile && (
        <button
          onClick={onNewProject}
          aria-label="Novo Projeto"
          style={{
            position: "fixed", bottom: 20, right: 20, zIndex: 200,
            width: 52, height: 52, borderRadius: "50%", border: "none",
            background: T.violet, color: "#fff", fontSize: 22,
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "pointer", boxShadow: `0 4px 16px ${T.violet}55, 0 2px 6px rgba(0,0,0,0.4)`,
          }}
        >
          ➕
        </button>
      )}

      {/* ── Summary ── */}
      <SummaryRow isMobile={isMobile} onInfo={openInfo} />

      {/* ── Overview ── */}
      {activeTab === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={grid2}>
            <RunsList onSelect={setSelectedRun} selected={selectedRun} onInfo={openInfo} />
            <TierDistribution onInfo={openInfo} />
          </div>
          <div style={grid2}>
            <CostByStageChart onInfo={openInfo} />
            <CostTrendChart onInfo={openInfo} />
          </div>
          <SavingsCalculator onInfo={openInfo} />
        </div>
      )}

      {/* ── Models ── */}
      {activeTab === "models" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={grid2}>
            <QualityRadar onInfo={openInfo} />
            <TopModelsMini onInfo={openInfo} />
          </div>
          <ModelLeaderboard filterTier={filterTier} setFilterTier={setFilterTier} isMobile={isMobile} onInfo={openInfo} />
        </div>
      )}

      {/* ── Learning ── */}
      {activeTab === "learning" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={grid2}>
            <CostTrendChart onInfo={openInfo} />
            <OriginEvolution onInfo={openInfo} />
          </div>
          <LearningLoop onInfo={openInfo} />
        </div>
      )}
    </div>
  )
}
