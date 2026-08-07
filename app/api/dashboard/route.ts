/**
 * GET /api/dashboard
 *
 * Substitui os arrays mockados que existiam direto em components/Dashboard.jsx
 * por agregados reais do Postgres, escopados ao usuário via RLS (client
 * user-scoped, mesma sessão que o resto do app).
 *
 * O que É real e vem do banco: runs, custo por run, tier por iteração, custo
 * por iteração/modelo (stage_iterations.cost_usd/model_provider/model_label
 * — colunas novas, ver db/schema.sql), quality_reports por dimensão,
 * decisões de gate humano.
 *
 * O que NÃO existe ainda como dado real (e por isso não aparece aqui):
 * "aprovação por modelo" no sentido estrito não é 1:1 — um gate humano é por
 * ETAPA, não por iteração/modelo individual (uma etapa pode passar por várias
 * iterações/modelos antes do gate). O leaderboard usa taxa de auto-crítica
 * aprovada como proxy, rotulado como tal — não como "aprovação humana".
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser, unauthorizedResponse } from '@/lib/devfactory/auth'
import { createSupabaseServerClient } from '@/lib/devfactory/supabase'

// Providers conhecidos do catálogo (ver model-selector.ts DEFAULT_MODELS) —
// mapeamento estático só pra categorizar a origem de um provider real, não
// pra inventar dado nenhum.
const PROVIDER_ORIGIN: Record<string, 'chinese' | 'western' | 'open-source'> = {
  deepseek: 'chinese', glm: 'chinese', qwen: 'chinese', moonshot: 'chinese', minimax: 'chinese',
  google: 'western', anthropic: 'western', openai: 'western', groq: 'western',
  ollama: 'open-source',
}

interface DbHumanGate { decision: string | null; decided_at: string }
interface DbStageOutput { id: string; stage: string; status: string; human_gates: DbHumanGate[] | null }
interface DbRun {
  id: string
  status: string
  total_cost_usd: number | string | null
  started_at: string
  completed_at: string | null
  projects: { name: string } | { name: string }[] | null
  stage_outputs: DbStageOutput[] | null
}
interface DbIteration {
  tier_used: number | null
  cost_usd: number | string | null
  model_provider: string | null
  model_label: string | null
  self_critique: { score?: number; passed?: boolean } | null
  stage_outputs: { stage: string; run_id: string } | { stage: string; run_id: string }[] | null
}
interface DbQualityReport { dimension: string | null; score: number | string | null }

function projectName(p: DbRun['projects']): string {
  if (!p) return 'Sem nome'
  return Array.isArray(p) ? (p[0]?.name ?? 'Sem nome') : p.name
}

function stageOutputOf(so: DbIteration['stage_outputs']): { stage: string; run_id: string } | null {
  if (!so) return null
  return Array.isArray(so) ? (so[0] ?? null) : so
}

export async function GET(req: NextRequest) {
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  const supabase = createSupabaseServerClient(req)

  const [runsRes, iterationsRes, qualityRes] = await Promise.all([
    supabase
      .from('pipeline_runs')
      .select('id, status, total_cost_usd, started_at, completed_at, projects(name), stage_outputs(id, stage, status, human_gates(decision, decided_at))')
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
      .limit(30),
    // Sem filtro .eq() manual aqui de propósito — PostgREST não suporta
    // filtrar por coluna de embed dois níveis abaixo (stage_outputs →
    // pipeline_runs) de forma confiável. A RLS de stage_iterations/
    // quality_reports já restringe as linhas ao dono via EXISTS (mesma
    // política usada por toda leitura autenticada no app, ver db/schema.sql)
    // — não precisa (nem pode) duplicar isso aqui.
    supabase
      .from('stage_iterations')
      .select('tier_used, cost_usd, model_provider, model_label, self_critique, stage_outputs(stage, run_id)')
      .limit(3000),
    supabase
      .from('quality_reports')
      .select('dimension, score')
      .limit(2000),
  ])

  const runs = (runsRes.data ?? []) as unknown as DbRun[]
  const iterations = (iterationsRes.data ?? []) as unknown as DbIteration[]
  const qualityReports = (qualityRes.data ?? []) as unknown as DbQualityReport[]

  // ── Runs list ──────────────────────────────────────────────────────────
  const runsList = runs.map(r => {
    const stageOutputs = r.stage_outputs ?? []
    const approvedStages = stageOutputs.filter(so => so.status === 'approved').length
    const gates = stageOutputs.flatMap(so => so.human_gates ?? [])
    const decided = gates.filter(g => g.decision === 'approved' || g.decision === 'rejected')
    const approvalRate = decided.length > 0
      ? decided.filter(g => g.decision === 'approved').length / decided.length
      : null
    return {
      id:            r.id,
      name:          projectName(r.projects),
      status:        r.status,
      date:          r.started_at,
      totalCost:     Number(r.total_cost_usd ?? 0),
      stagesTotal:   stageOutputs.length,
      stagesApproved: approvedStages,
      approvalRate,
    }
  })

  // ── Summary ────────────────────────────────────────────────────────────
  const totalCost  = runsList.reduce((s, r) => s + r.totalCost, 0)
  const totalCalls = iterations.length
  const allGates = runs.flatMap(r => (r.stage_outputs ?? []).flatMap(so => so.human_gates ?? []))
  const decidedGates = allGates.filter(g => g.decision === 'approved' || g.decision === 'rejected')
  const avgApproval = decidedGates.length > 0
    ? decidedGates.filter(g => g.decision === 'approved').length / decidedGates.length
    : null

  // ── Custo por etapa ────────────────────────────────────────────────────
  const costByStageMap = new Map<string, number>()
  for (const it of iterations) {
    const so = stageOutputOf(it.stage_outputs)
    if (!so) continue
    costByStageMap.set(so.stage, (costByStageMap.get(so.stage) ?? 0) + Number(it.cost_usd ?? 0))
  }
  const costByStage = [...costByStageMap.entries()].map(([stage, cost]) => ({ stage, cost }))

  // ── Custo por run (trend) ──────────────────────────────────────────────
  const costTrend = [...runsList].reverse().map((r, i) => ({ run: `Run ${i + 1}`, cost: r.totalCost }))

  // ── Distribuição de tier ───────────────────────────────────────────────
  const tierCounts = new Map<number, number>()
  for (const it of iterations) {
    if (it.tier_used == null) continue
    tierCounts.set(it.tier_used, (tierCounts.get(it.tier_used) ?? 0) + 1)
  }
  const tierTotal = [...tierCounts.values()].reduce((s, n) => s + n, 0)
  const tierLabels: Record<number, string> = { 1: 'Tier 1 — free/cheap', 2: 'Tier 2 — mid', 3: 'Tier 3 — frontier' }
  const tierDistribution = [1, 2, 3].map(tier => {
    const calls = tierCounts.get(tier) ?? 0
    return { tier: tierLabels[tier], calls, pct: tierTotal > 0 ? Math.round((calls / tierTotal) * 100) : 0 }
  })

  // ── Origem (derivada do provider real, não inventada) ──────────────────
  const originCounts = new Map<string, { calls: number; cost: number }>()
  for (const it of iterations) {
    if (!it.model_provider) continue
    const origin = PROVIDER_ORIGIN[it.model_provider] ?? 'western'
    const bucket = originCounts.get(origin) ?? { calls: 0, cost: 0 }
    bucket.calls += 1
    bucket.cost += Number(it.cost_usd ?? 0)
    originCounts.set(origin, bucket)
  }
  const originTotal = [...originCounts.values()].reduce((s, b) => s + b.calls, 0)
  const originColors: Record<string, string> = { chinese: '#e879f9', western: '#60a5fa', 'open-source': '#34d399' }
  const originSplit = [...originCounts.entries()].map(([origin, b]) => ({
    origin,
    pct:  originTotal > 0 ? Math.round((b.calls / originTotal) * 100) : 0,
    cost: `$${(b.calls > 0 ? b.cost / b.calls : 0).toFixed(4)}`,
    color: originColors[origin] ?? '#94a3b8',
  }))

  // ── Leaderboard de modelos ──────────────────────────────────────────────
  // "approvals" aqui é taxa de auto-crítica aprovada (por iteração), NÃO
  // aprovação humana — gate humano é por etapa, não por modelo/iteração
  // individual, então não dá pra atribuir 1:1 sem inventar o dado.
  const modelMap = new Map<string, { provider: string; label: string; calls: number; passed: number; cost: number; tierSum: number }>()
  for (const it of iterations) {
    if (!it.model_provider || !it.model_label) continue
    const key = `${it.model_provider}::${it.model_label}`
    const m = modelMap.get(key) ?? { provider: it.model_provider, label: it.model_label, calls: 0, passed: 0, cost: 0, tierSum: 0 }
    m.calls += 1
    if (it.self_critique?.passed) m.passed += 1
    m.cost += Number(it.cost_usd ?? 0)
    m.tierSum += it.tier_used ?? 0
    modelMap.set(key, m)
  }
  const modelPerformance = [...modelMap.values()].map(m => ({
    model:    m.label,
    provider: m.provider,
    origin:   PROVIDER_ORIGIN[m.provider] ?? 'western',
    tier:     Math.round(m.tierSum / m.calls) || 1,
    calls:    m.calls,
    passedRate: m.passed / m.calls,
    cost:     m.cost,
    isFree:   m.cost === 0,
  })).sort((a, b) => b.passedRate - a.passedRate)

  // ── Quality Council (média real por dimensão) ───────────────────────────
  const qualityMap = new Map<string, { sum: number; count: number }>()
  for (const q of qualityReports) {
    if (!q.dimension || q.score == null) continue
    const bucket = qualityMap.get(q.dimension) ?? { sum: 0, count: 0 }
    bucket.sum += Number(q.score)
    bucket.count += 1
    qualityMap.set(q.dimension, bucket)
  }
  const qualityRadar = [...qualityMap.entries()].map(([dimension, b]) => ({
    dimension, score: Math.round(b.sum / b.count),
  }))

  // ── Atividade recente (gates humanos reais, não narrativa inventada) ────
  const recentActivity = runs
    .flatMap(r => (r.stage_outputs ?? []).flatMap(so =>
      (so.human_gates ?? []).map(g => ({
        runName:  projectName(r.projects),
        stage:    so.stage,
        decision: g.decision,
        decidedAt: g.decided_at,
      })),
    ))
    .filter(e => e.decision)
    .sort((a, b) => new Date(b.decidedAt).getTime() - new Date(a.decidedAt).getTime())
    .slice(0, 12)

  return NextResponse.json({
    summary: {
      totalRuns:  runsList.length,
      runningRuns: runsList.filter(r => r.status === 'running' || r.status === 'awaiting_human').length,
      totalCost,
      totalCalls,
      avgApproval,
    },
    runs: runsList,
    costByStage,
    costTrend,
    tierDistribution,
    originSplit,
    modelPerformance,
    qualityRadar,
    recentActivity,
  })
}
