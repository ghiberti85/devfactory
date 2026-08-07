'use client'

import { useState, useEffect, useCallback } from "react"
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis } from "recharts"

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
        body: "Veja a Calculadora de Economia mais abaixo pra uma estimativa de quanto rodar sempre no modelo mais caro do catálogo custaria, comparado ao seu custo médio real por run."
      }
    ]
  },
  total_calls: {
    title: "Chamadas de Modelo",
    icon: "📡",
    sections: [
      {
        heading: "O que conta como chamada?",
        body: "Cada iteração de etapa registrada — uma execução do agente principal seguida de auto-crítica. Uma etapa que precisa de retry gera mais de uma iteração/chamada."
      },
      {
        heading: "Chamadas gratuitas",
        body: "O Complexity Router em si sempre usa um modelo gratuito. Além dele, toda operação classificada como Tier 1 tende a usar modelos com free tier (Gemini Flash-Lite, GLM-4.7-Flash) ou locais (Ollama) — veja a proporção real na Distribuição de Tier."
      }
    ]
  },
  approval_rate: {
    title: "Taxa de Aprovação Humana",
    icon: "✅",
    sections: [
      {
        heading: "Como é calculada?",
        body: "Proporção de etapas aprovadas (ou aprovadas-com-edição) pelo humano sobre o total de etapas que já passaram pelo gate em todos os seus runs. Score composto do Selector: 60% aprovação humana + 30% auto-crítica + 10% custo."
      },
      {
        heading: "Impacto no sistema",
        body: "O Model Performance History atualiza o score de cada modelo após cada gate. Com o tempo, o Selector passa a preferir empiricamente modelos com maior taxa de aprovação para cada etapa específica."
      },
      {
        heading: "Por que melhora com o tempo?",
        body: "O Selector evita modelos que tiveram auto-crítica < 0.70 em etapas críticas, escalando para tier superior antes mesmo do gate humano. Quanto mais runs você tiver, mais essa tendência aparece nos seus próprios números — os valores nesta tela são sempre da sua conta, não uma média de mercado."
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
        heading: "O que observar aqui",
        body: "Acompanhe se o custo médio por run cai ao longo do tempo sem queda na taxa de aprovação — esse é o sinal de que o Selector está encontrando o modelo mais barato que ainda passa no seu padrão de qualidade em cada etapa."
      }
    ]
  },
  savings: {
    title: "Calculadora de Economia",
    icon: "📈",
    sections: [
      {
        heading: "Base de comparação",
        body: "Compara o custo médio real dos seus runs (calculado a partir do seu próprio histórico nesta conta) contra uma estimativa de rodar tudo sempre em Claude Opus — o modelo mais caro do catálogo, usado aqui só como teto de referência."
      },
      {
        heading: "Por que a diferença pode ser grande?",
        body: "O Complexity Router manda a maioria das operações simples (boilerplate, docs, SEO) para modelos Tier 1 — muitos deles gratuitos. Só decisões críticas (auth, arquitetura, segurança) sobem para Tier 3. Multiplicado por várias chamadas por run, a diferença acumula rápido."
      },
      {
        heading: "Limitações da estimativa",
        body: "Com poucos runs no histórico, a média ainda não é representativa — ela fica mais confiável conforme você acumula runs de projetos variados. Projetos com muita lógica de negócio nova tendem a ter mais operações Tier 3, elevando o custo médio real."
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

function EmptyState({ children }) {
  return (
    <div style={{ padding: "20px 8px", textAlign: "center", fontSize: 11, color: T.text2, lineHeight: 1.6 }}>
      {children}
    </div>
  )
}

function SummaryRow({ isMobile, onInfo, summary }) {
  const totalRuns   = summary?.totalRuns ?? 0
  const runningRuns = summary?.runningRuns ?? 0
  const totalCost   = summary?.totalCost ?? 0
  const totalCalls  = summary?.totalCalls ?? 0
  const avgApproval = summary?.avgApproval

  const stats = [
    { value: totalRuns,                                                       label: "Pipeline runs",  sub: `${totalRuns - runningRuns} concluídos · ${runningRuns} em andamento`, color: T.violet, key: "pipeline_runs" },
    { value: `$${totalCost.toFixed(4)}`,                                      label: "Total em LLMs",  sub: totalCost < 0.000001 ? "grátis até agora" : "acumulado nesta conta",   color: T.green,  key: "total_cost"    },
    { value: totalCalls,                                                      label: "Chamadas",       sub: "iterações de etapa registradas",                                      color: T.blue,   key: "total_calls"   },
    { value: avgApproval == null ? "—" : `${(avgApproval * 100).toFixed(0)}%`, label: "Aprovação",      sub: avgApproval == null ? "sem gates decididos ainda" : "das etapas decididas", color: T.amber,  key: "approval_rate" },
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

const RUNS_PER_PAGE = 5

function RunsList({ onSelect, selected, onInfo, runs, onNewProject }) {
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(runs.length / RUNS_PER_PAGE))
  const safePage  = Math.min(page, pageCount - 1)
  const pageRuns  = runs.slice(safePage * RUNS_PER_PAGE, safePage * RUNS_PER_PAGE + RUNS_PER_PAGE)

  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <Label infoKey="pipeline_runs" onInfo={onInfo} style={{ marginBottom: 0 }}>Runs recentes</Label>
        {runs.length > RUNS_PER_PAGE && (
          <span style={{ ...mono, fontSize: 9, color: T.text2 }}>
            {safePage * RUNS_PER_PAGE + 1}–{Math.min(runs.length, safePage * RUNS_PER_PAGE + RUNS_PER_PAGE)} de {runs.length}
          </span>
        )}
      </div>
      {runs.length === 0 ? (
        <EmptyState>
          Nenhum run ainda.{onNewProject && <> Clique em <a onClick={onNewProject} style={{ color: T.violet, cursor: "pointer" }}>Novo Projeto</a> pra criar o primeiro.</>}
        </EmptyState>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {pageRuns.map(run => {
              const isActive = selected === run.id
              const statusColor = run.status === "completed" ? T.green : run.status === "failed" ? T.red : T.amber
              const dateLabel = new Date(run.date).toLocaleDateString("pt-BR")
              return (
                <div key={run.id} onClick={() => onSelect(run.id === selected ? null : run.id)} style={{ padding: "10px 12px", borderRadius: 8, border: `1px solid ${isActive ? T.violet + "50" : T.border}`, background: isActive ? `${T.violet}08` : T.bg2, cursor: "pointer", transition: "all 0.15s" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, color: isActive ? T.violet : T.text0, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{run.name}</span>
                    <span style={{ ...mono, fontSize: 10, color: statusColor, whiteSpace: "nowrap", flexShrink: 0 }}>
                      {run.status === "running" || run.status === "awaiting_human" ? "◉ running" : run.status === "failed" ? "✕ failed" : "✓ done"}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 6 }}>
                    <span style={{ ...mono, fontSize: 10, color: T.text2 }}>{dateLabel}</span>
                    <span style={{ ...mono, fontSize: 10, color: T.green }}>${run.totalCost.toFixed(4)}</span>
                    <span style={{ ...mono, fontSize: 10, color: T.text2 }}>{run.stagesApproved}/{run.stagesTotal} etapas</span>
                    {run.approvalRate !== null && <span style={{ ...mono, fontSize: 10, color: run.approvalRate >= 0.9 ? T.green : T.amber }}>{(run.approvalRate * 100).toFixed(0)}% aprovação</span>}
                  </div>
                </div>
              )
            })}
          </div>
          {pageCount > 1 && (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 10, marginTop: 12 }}>
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={safePage === 0}
                aria-label="Página anterior"
                style={{ ...mono, fontSize: 11, padding: "4px 10px", borderRadius: 6, border: `1px solid ${T.border2}`, background: "transparent", color: safePage === 0 ? T.text2 : T.text0, cursor: safePage === 0 ? "default" : "pointer", opacity: safePage === 0 ? 0.4 : 1 }}
              >
                ‹
              </button>
              <span style={{ ...mono, fontSize: 10, color: T.text2 }}>{safePage + 1} / {pageCount}</span>
              <button
                onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                disabled={safePage === pageCount - 1}
                aria-label="Próxima página"
                style={{ ...mono, fontSize: 11, padding: "4px 10px", borderRadius: 6, border: `1px solid ${T.border2}`, background: "transparent", color: safePage === pageCount - 1 ? T.text2 : T.text0, cursor: safePage === pageCount - 1 ? "default" : "pointer", opacity: safePage === pageCount - 1 ? 0.4 : 1 }}
              >
                ›
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  )
}

function CostByStageChart({ onInfo, data }) {
  const withLabels = data.map(d => ({ ...d, label: STAGE_META[d.stage]?.label ?? d.stage }))
  return (
    <Card>
      <Label infoKey="total_cost" onInfo={onInfo}>Custo por etapa</Label>
      {data.length === 0 ? <EmptyState>Sem chamadas de modelo registradas ainda.</EmptyState> : (
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={withLabels} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ ...mono, fontSize: 8, fill: T.text2 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ ...mono, fontSize: 8, fill: T.text2 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(3)}`} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="cost" radius={[4, 4, 0, 0]} name="cost">
              {withLabels.map((d, i) => <Cell key={i} fill={STAGE_META[d.stage]?.color ?? T.violet} opacity={0.85} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  )
}

function CostTrendChart({ onInfo, data }) {
  const first = data[0]?.cost ?? 0
  const last  = data[data.length - 1]?.cost ?? 0
  const delta = first > 0 ? Math.round(((last - first) / first) * 100) : null

  return (
    <Card>
      <Label infoKey="learning_loop" onInfo={onInfo}>Custo por run</Label>
      {data.length < 2 ? <EmptyState>Precisa de pelo menos 2 runs concluídos pra mostrar uma tendência.</EmptyState> : (
        <>
          <ResponsiveContainer width="100%" height={150}>
            <LineChart data={data} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
              <XAxis dataKey="run" tick={{ ...mono, fontSize: 8, fill: T.text2 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ ...mono, fontSize: 8, fill: T.text2 }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(3)}`} />
              <Tooltip content={<CustomTooltip />} />
              <Line dataKey="cost" stroke={T.violet} strokeWidth={2} dot={{ fill: T.violet, r: 3 }} name="cost" />
            </LineChart>
          </ResponsiveContainer>
          {delta !== null && (
            <div style={{ ...mono, fontSize: 10, color: delta <= 0 ? T.green : T.amber, marginTop: 8 }}>
              {delta <= 0 ? "↓" : "↑"} {Math.abs(delta)}% do 1º ao último run
            </div>
          )}
        </>
      )}
    </Card>
  )
}

function TierDistribution({ onInfo, tierData, originData }) {
  const hasTierData = tierData.some(t => t.calls > 0)
  return (
    <Card>
      <Label infoKey="tier_distribution" onInfo={onInfo}>Distribuição de tier & origem</Label>
      {!hasTierData ? <EmptyState>Sem iterações registradas ainda.</EmptyState> : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
            {tierData.map((t, i) => {
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
          {originData.length > 0 && (
            <div style={{ display: "flex", borderTop: `1px solid ${T.border}`, paddingTop: 14 }}>
              {originData.map(o => (
                <div key={o.origin} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ ...mono, fontSize: 20, fontWeight: 700, color: o.color }}>{o.pct}%</div>
                  <div style={{ fontSize: 10, color: T.text2, marginTop: 2, textTransform: "capitalize" }}>{o.origin}</div>
                  <div style={{ ...mono, fontSize: 9, color: o.color }}>{o.cost}/call</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  )
}

function SavingsCalculator({ onInfo, avgCostPerRun }) {
  const [runs, setRuns] = useState(10)
  // Teto de referência: rodar tudo sempre no modelo mais caro do catálogo
  // (Claude Opus, ~$5/$25 por 1M tokens) em vez do seu custo médio real por
  // run — não é um dado observado, é só o limite superior de comparação.
  const OPUS_ESTIMATE_PER_RUN = 0.42
  const hasData = avgCostPerRun > 0
  const devCost  = (runs * avgCostPerRun).toFixed(2)
  const opusCost = (runs * OPUS_ESTIMATE_PER_RUN).toFixed(2)
  const saved    = (runs * (OPUS_ESTIMATE_PER_RUN - avgCostPerRun)).toFixed(2)
  const pct      = hasData ? (((OPUS_ESTIMATE_PER_RUN - avgCostPerRun) / OPUS_ESTIMATE_PER_RUN) * 100).toFixed(0) : "—"

  return (
    <Card>
      <Label infoKey="savings" onInfo={onInfo}>Calculadora de economia</Label>
      {!hasData ? <EmptyState>Termine pelo menos um run com custo registrado pra ver essa comparação.</EmptyState> : (
        <>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: T.text2, marginBottom: 6 }}>Runs por mês: <span style={{ color: T.violet, ...mono }}>{runs}</span></div>
            <input type="range" min={1} max={50} value={runs} onChange={e => setRuns(+e.target.value)} style={{ width: "100%", accentColor: T.violet }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            {[
              { label: "DevFactory (seu custo médio)", value: `$${devCost}`,  color: T.green  },
              { label: "Single Opus (teto)",           value: `$${opusCost}`, color: T.red    },
              { label: "Economia",                     value: `$${saved}`,    color: T.violet, sub: `↓ ${pct}%` },
            ].map(s => (
              <div key={s.label} style={{ background: T.bg2, borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 10, color: T.text2, marginBottom: 4 }}>{s.label}</div>
                <div style={{ ...mono, fontSize: 16, fontWeight: 700, color: s.color }}>{s.value}</div>
                {s.sub && <div style={{ ...mono, fontSize: 10, color: s.color }}>{s.sub}</div>}
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  )
}

function ModelLeaderboard({ filterTier, setFilterTier, isMobile, onInfo, models }) {
  const filtered = filterTier ? models.filter(m => m.tier === filterTier) : models
  const sorted   = [...filtered].sort((a, b) => b.passedRate - a.passedRate)

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
      {sorted.length === 0 ? <EmptyState>Sem modelos com chamadas registradas ainda{filterTier ? " neste tier" : ""}.</EmptyState> : (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(300px, 1fr))", gap: 8 }}>
          {sorted.map((m, i) => (
            <div key={`${m.provider}-${m.model}`} style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 8, padding: 12, position: "relative" }}>
              <div style={{ ...mono, fontSize: 9, color: T.text2, position: "absolute", top: 10, right: 10 }}>#{i + 1}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap", paddingRight: 24 }}>
                <TierDot tier={m.tier} />
                <span style={{ fontSize: 11, color: T.text0, fontWeight: 600 }}>{m.model}</span>
                <OriginBadge origin={m.origin} />
                {m.isFree && <span style={{ ...mono, fontSize: 9, color: T.green, background: `${T.green}15`, border: `1px solid ${T.green}30`, borderRadius: 3, padding: "1px 5px" }}>FREE</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <ScoreBar score={m.passedRate} color={TIER_COLOR[m.tier]} height={4} />
                <span style={{ ...mono, fontSize: 11, color: TIER_COLOR[m.tier], minWidth: 32 }}>{(m.passedRate * 100).toFixed(0)}%</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                {[["Calls", m.calls], ["Auto-crítica ok", `${(m.passedRate * 100).toFixed(0)}%`], ["Cost/call", m.isFree ? "$0.00" : `$${(m.cost / m.calls).toFixed(5)}`], ["Provider", m.provider]].map(([l, v]) => (
                  <div key={l}>
                    <div style={{ fontSize: 9, color: T.text2 }}>{l}</div>
                    <div style={{ ...mono, fontSize: 10, color: T.text1, marginTop: 1 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function QualityRadar({ onInfo, data }) {
  return (
    <Card>
      <Label infoKey="quality_council" onInfo={onInfo}>Quality Council — média acumulada</Label>
      {data.length === 0 ? <EmptyState>Nenhum relatório de Quality Council ainda.</EmptyState> : (
        <ResponsiveContainer width="100%" height={200}>
          <RadarChart data={data} margin={{ top: 4, right: 20, bottom: 4, left: 20 }}>
            <PolarGrid stroke={T.border2} />
            <PolarAngleAxis dataKey="dimension" tick={{ ...mono, fontSize: 9, fill: T.text2 }} />
            <Radar dataKey="score" stroke={T.violet} fill={T.violet} fillOpacity={0.15} strokeWidth={2} />
            <Tooltip content={<CustomTooltip />} />
          </RadarChart>
        </ResponsiveContainer>
      )}
    </Card>
  )
}

function TopModelsMini({ onInfo, models }) {
  return (
    <Card>
      <Label infoKey="model_performance" onInfo={onInfo}>Top models por auto-crítica</Label>
      {models.length === 0 ? <EmptyState>Sem dados ainda.</EmptyState> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[...models].sort((a, b) => b.passedRate - a.passedRate).slice(0, 6).map(m => (
            <div key={`${m.provider}-${m.model}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <TierDot tier={m.tier} />
              <span style={{ fontSize: 11, color: T.text1, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.model}</span>
              <ScoreBar score={m.passedRate} color={TIER_COLOR[m.tier]} height={4} />
              <span style={{ ...mono, fontSize: 10, color: T.text2, minWidth: 28 }}>{(m.passedRate * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function LearningLoop({ onInfo, activity }) {
  const colors = { approved: T.green, rejected: T.amber, edited: T.blue }
  const icons  = { approved: "✓", rejected: "↺", edited: "✎" }
  const labels = { approved: "aprovado", rejected: "rejeitado — retry com feedback", edited: "aprovado com edição" }

  return (
    <Card>
      <Label infoKey="learning_loop" onInfo={onInfo}>Atividade recente — decisões de gate</Label>
      {activity.length === 0 ? <EmptyState>Nenhuma decisão de gate humano registrada ainda.</EmptyState> : (
        <div style={{ position: "relative", paddingLeft: 20 }}>
          <div style={{ position: "absolute", left: 6, top: 0, bottom: 0, width: 1, background: T.border2 }} />
          {activity.map((ev, i) => {
            const c = colors[ev.decision] ?? T.text2
            return (
              <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10, alignItems: "flex-start", position: "relative" }}>
                <div style={{ position: "absolute", left: -20, top: 4, width: 8, height: 8, borderRadius: "50%", background: c, border: `2px solid ${T.bg1}` }} />
                <span style={{ ...mono, fontSize: 10, color: c, minWidth: 10, flexShrink: 0 }}>{icons[ev.decision] ?? "·"}</span>
                <span style={{ fontSize: 11, color: T.text1, flex: 1, lineHeight: 1.5 }}>
                  <strong style={{ color: T.text0 }}>{ev.runName}</strong> — {STAGE_META[ev.stage]?.label ?? ev.stage}: {labels[ev.decision] ?? ev.decision}
                </span>
                <span style={{ ...mono, fontSize: 9, color: T.text2, flexShrink: 0 }}>{new Date(ev.decidedAt).toLocaleDateString("pt-BR")}</span>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

function OriginEvolution({ onInfo, data }) {
  return (
    <Card>
      <Label infoKey="learning_loop" onInfo={onInfo}>Distribuição de origem</Label>
      {data.length === 0 ? <EmptyState>Sem chamadas de modelo registradas ainda.</EmptyState> : (
        <>
          <p style={{ fontSize: 11, color: T.text1, marginTop: 0, marginBottom: 14, lineHeight: 1.6 }}>
            De onde vêm os modelos usados nas suas chamadas até agora, por custo médio por chamada.
          </p>
          {data.map(o => (
            <div key={o.origin} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: T.text1, textTransform: "capitalize" }}>{o.origin}</span>
                <span style={{ ...mono, fontSize: 10, color: o.color }}>{o.pct}% · {o.cost}/call</span>
              </div>
              <ScoreBar score={o.pct / 100} color={o.color} height={5} />
            </div>
          ))}
        </>
      )}
    </Card>
  )
}

// ─── Dashboard data ─────────────────────────────────────────────────────────
// Substitui os arrays mockados: busca agregados reais em GET /api/dashboard,
// escopados por RLS ao usuário logado (ver app/api/dashboard/route.ts).

const EMPTY_DASHBOARD = {
  summary: { totalRuns: 0, runningRuns: 0, totalCost: 0, totalCalls: 0, avgApproval: null },
  runs: [], costByStage: [], costTrend: [], tierDistribution: [
    { tier: "Tier 1 — free/cheap", calls: 0, pct: 0 },
    { tier: "Tier 2 — mid", calls: 0, pct: 0 },
    { tier: "Tier 3 — frontier", calls: 0, pct: 0 },
  ],
  originSplit: [], modelPerformance: [], qualityRadar: [], recentActivity: [],
}

function useDashboardData() {
  const [data, setData]       = useState(EMPTY_DASHBOARD)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard")
      if (!res.ok) throw new Error("Falha ao carregar os dados do dashboard.")
      setData(await res.json())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar os dados do dashboard.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  return { data, loading, error, refetch: fetchData }
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

/**
 * @param {{ onNewProject?: () => void, onSettings?: () => void }} props
 */
export default function Dashboard({ onNewProject, onSettings } = {}) {
  const { isMobile, isTablet } = useBreakpoint()
  const [selectedRun, setSelectedRun] = useState(null)
  const [filterTier,  setFilterTier]  = useState(null)
  const [activeTab,   setActiveTab]   = useState("overview")
  const [activeInfo,  setActiveInfo]  = useState(null)
  const { data, loading, error } = useDashboardData()

  const openInfo  = useCallback((key) => setActiveInfo(key), [])
  const closeInfo = useCallback(() => setActiveInfo(null), [])

  const avgCostPerRun = data.summary.totalRuns > 0 ? data.summary.totalCost / data.summary.totalRuns : 0

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
        <div style={{ display: "flex", gap: 14, alignItems: "center", alignSelf: isMobile ? "stretch" : "auto" }}>
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
          <div style={{ display: "flex", gap: 6, background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 8, padding: 4, flex: isMobile ? 1 : "none", minWidth: 0 }}>
            {[{id:"overview",label:"Overview"},{id:"models",label:"Models"},{id:"learning",label:"Learning"}].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)} style={{ ...mono, fontSize: 11, padding: "6px 12px", borderRadius: 6, border: "none", background: activeTab === t.id ? T.violet : "transparent", color: activeTab === t.id ? "#fff" : T.text2, cursor: "pointer", flex: 1, whiteSpace: "nowrap", textAlign: "center" }}>
                {t.label}
              </button>
            ))}
          </div>
          {onSettings && (
            <button
              onClick={onSettings}
              aria-label="Configurações — API keys e conexões"
              title="Configurações — API keys e conexões"
              style={{
                width: 32, height: 32, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                borderRadius: 8, border: `1px solid ${T.border}`, background: T.bg2, color: T.text2,
                cursor: "pointer", fontSize: 14,
              }}
            >
              ⚙️
            </button>
          )}
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

      {error && (
        <div style={{ background: "#1a0a0a", border: `1px solid ${T.red}40`, borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 12, color: T.red }}>
          {error}
        </div>
      )}

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 0", color: T.text2, fontSize: 12, ...mono }}>
          Carregando dados…
        </div>
      ) : (
        <>
          {/* ── Summary ── */}
          <SummaryRow isMobile={isMobile} onInfo={openInfo} summary={data.summary} />

          {/* ── Overview ── */}
          {activeTab === "overview" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={grid2}>
                <RunsList onSelect={setSelectedRun} selected={selectedRun} onInfo={openInfo} runs={data.runs} onNewProject={onNewProject} />
                <TierDistribution onInfo={openInfo} tierData={data.tierDistribution} originData={data.originSplit} />
              </div>
              <div style={grid2}>
                <CostByStageChart onInfo={openInfo} data={data.costByStage} />
                <CostTrendChart onInfo={openInfo} data={data.costTrend} />
              </div>
              <SavingsCalculator onInfo={openInfo} avgCostPerRun={avgCostPerRun} />
            </div>
          )}

          {/* ── Models ── */}
          {activeTab === "models" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={grid2}>
                <QualityRadar onInfo={openInfo} data={data.qualityRadar} />
                <TopModelsMini onInfo={openInfo} models={data.modelPerformance} />
              </div>
              <ModelLeaderboard filterTier={filterTier} setFilterTier={setFilterTier} isMobile={isMobile} onInfo={openInfo} models={data.modelPerformance} />
            </div>
          )}

          {/* ── Learning ── */}
          {activeTab === "learning" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={grid2}>
                <CostTrendChart onInfo={openInfo} data={data.costTrend} />
                <OriginEvolution onInfo={openInfo} data={data.originSplit} />
              </div>
              <LearningLoop onInfo={openInfo} activity={data.recentActivity} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
