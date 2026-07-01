/**
 * DevFactory — Model Selector
 * Seleciona o modelo ideal para cada operação da pipeline,
 * cruzando tier, etapa, força, custo e histórico de performance.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type Provider =
  | 'anthropic' | 'openai' | 'google' | 'deepseek'
  | 'qwen' | 'moonshot' | 'minimax' | 'glm'
  | 'groq' | 'mistral' | 'ollama' | 'openrouter' | 'custom'

export type ModelStrength =
  | 'coding' | 'reasoning' | 'creative' | 'analysis'
  | 'security' | 'multilingual' | 'agentic'

export type LatencyProfile = 'fast' | 'medium' | 'slow'
export type ModelOrigin    = 'western' | 'chinese' | 'open-source'
export type Tier           = 1 | 2 | 3

export type Stage =
  | 'codebase_analysis'
  | 'planning'
  | 'docs_initial'
  | 'design'
  | 'backend'
  | 'frontend'
  | 'tests'
  | 'quality_council'
  | 'docs_final'

export type QualityDimension =
  | 'security' | 'performance' | 'seo' | 'a11y' | 'best_practices'

export interface Model {
  id: string
  name: string
  displayName: string
  provider: Provider
  modelId: string            // identificador real na API
  isDefault: boolean
  isActive: boolean
  isLocal: boolean           // Ollama

  tierCapability: Tier
  contextWindow: number
  strengths: ModelStrength[]

  costInputPer1M: number     // USD
  costOutputPer1M: number    // USD
  hasFreeTier: boolean
  freeTierRpm?: number
  freeTierRpd?: number

  latencyProfile: LatencyProfile
  origin: ModelOrigin
  license?: string
  apiEndpoint?: string       // para modelos custom
  apiKeyRef?: string         // referência ao secret
}

export interface PerformanceRecord {
  modelId: string
  stage: Stage
  operation?: string
  totalCalls: number
  humanApprovals: number
  humanRejections: number
  avgSelfCritiqueScore: number  // 0-1
  avgCostUsd: number
  avgLatencyMs: number
  performanceScore: number       // 0-1, calculado
}

export interface SelectionContext {
  stage: Stage
  operation?: string             // operação específica dentro da etapa
  tier: Tier                     // determinado pelo Complexity Router
  qualityDimension?: QualityDimension  // para Quality Council
  budgetRemainingUsd?: number    // orçamento restante do run
  preferFreeTier?: boolean       // forçar uso de modelos gratuitos
  preferLocal?: boolean          // forçar Ollama
  excludeOrigins?: ModelOrigin[] // ex: ['chinese'] por questões de compliance

  // ── BYOK enforcement ──────────────────────────────────────────────────────
  // Providers para os quais o USUÁRIO ATUAL configurou sua própria API key.
  // Modelos pagos só ficam disponíveis se o provider estiver nesta lista.
  // Modelos com hasFreeTier=true ou isLocal=true ficam sempre disponíveis,
  // pois usam a key padrão da plataforma (custo zero, sem risco de
  // consumir a assinatura paga de outro usuário).
  userProviders?: Provider[]
}

export interface SelectorWeights {
  tier: number           // default 0.30
  strength: number       // default 0.25
  performance: number    // default 0.25
  cost: number           // default 0.15
  latency: number        // default 0.05
}

export interface SelectionResult {
  model: Model
  score: number
  reason: string
  estimatedCostUsd: number
  alternatives: Array<{ model: Model; score: number }>
}

// ─── Stage Profile Map ────────────────────────────────────────────────────────
// Define o perfil de exigência de cada etapa e operação

interface StageProfile {
  defaultTier: Tier
  progressiveEscalation: boolean  // começa no tier informado, escala se falhar
  preferredStrengths: ModelStrength[]
  latencyRequirement: LatencyProfile
  parallelizable: boolean
}

const STAGE_PROFILES: Record<Stage, StageProfile> = {
  codebase_analysis: {
    defaultTier: 2,
    progressiveEscalation: true,
    preferredStrengths: ['analysis', 'reasoning'],
    latencyRequirement: 'medium',
    parallelizable: false,
  },
  planning: {
    defaultTier: 3,
    progressiveEscalation: false,
    preferredStrengths: ['reasoning', 'analysis'],
    latencyRequirement: 'slow',
    parallelizable: false,
  },
  docs_initial: {
    defaultTier: 2,
    progressiveEscalation: true,
    preferredStrengths: ['coding', 'analysis'],
    latencyRequirement: 'medium',
    parallelizable: false,
  },
  design: {
    defaultTier: 2,
    progressiveEscalation: true,
    preferredStrengths: ['creative', 'coding'],
    latencyRequirement: 'medium',
    parallelizable: false,
  },
  backend: {
    defaultTier: 2,
    progressiveEscalation: true,
    preferredStrengths: ['coding', 'security', 'reasoning'],
    latencyRequirement: 'medium',
    parallelizable: false,
  },
  frontend: {
    defaultTier: 2,
    progressiveEscalation: true,
    preferredStrengths: ['coding', 'creative'],
    latencyRequirement: 'medium',
    parallelizable: false,
  },
  tests: {
    defaultTier: 1,
    progressiveEscalation: true,
    preferredStrengths: ['coding', 'analysis'],
    latencyRequirement: 'fast',
    parallelizable: false,
  },
  quality_council: {
    defaultTier: 2,
    progressiveEscalation: false,
    preferredStrengths: ['security', 'analysis'],
    latencyRequirement: 'medium',
    parallelizable: true,  // dimensões rodam em paralelo
  },
  docs_final: {
    defaultTier: 1,
    progressiveEscalation: false,
    preferredStrengths: ['analysis'],
    latencyRequirement: 'fast',
    parallelizable: false,
  },
}

// Operações críticas que forçam Tier 3 independente do contexto
const CRITICAL_OPERATIONS = new Set([
  'auth',
  'security_review',
  'architecture_decision',
  'prd_generation',
  'risk_mapping',
  'db_schema',
])

// Forças requeridas por dimensão do Quality Council
const QUALITY_DIMENSION_STRENGTHS: Record<QualityDimension, ModelStrength[]> = {
  security:       ['security', 'reasoning'],
  performance:    ['analysis', 'coding'],
  seo:            ['analysis'],
  a11y:           ['analysis', 'coding'],
  best_practices: ['coding', 'analysis'],
}

// ─── Model Selector ───────────────────────────────────────────────────────────

export class ModelSelector {
  private models: Model[]
  private performanceHistory: PerformanceRecord[]
  private weights: SelectorWeights

  constructor(
    models: Model[],
    performanceHistory: PerformanceRecord[] = [],
    weights: Partial<SelectorWeights> = {}
  ) {
    this.models = models.filter(m => m.isActive)
    this.performanceHistory = performanceHistory
    this.weights = {
      tier:        weights.tier        ?? 0.30,
      strength:    weights.strength    ?? 0.25,
      performance: weights.performance ?? 0.25,
      cost:        weights.cost        ?? 0.15,
      latency:     weights.latency     ?? 0.05,
    }
  }

  select(ctx: SelectionContext): SelectionResult {
    const candidates = this.filterCandidates(ctx)

    if (candidates.length === 0) {
      throw new Error(
        `Nenhum modelo disponível para stage="${ctx.stage}" tier=${ctx.tier}. ` +
        'Verifique o registry, filtros de origem/budget, ou se o usuário ' +
        'configurou uma API key para algum provider pago neste tier ' +
        '(modelos pagos exigem userProviders configurado).'
      )
    }

    const scored = candidates
      .map(model => ({ model, score: this.score(model, ctx) }))
      .sort((a, b) => b.score - a.score)

    const best = scored[0]
    const alternatives = scored.slice(1, 4)

    return {
      model: best.model,
      score: best.score,
      reason: this.buildReason(best.model, ctx),
      estimatedCostUsd: this.estimateCost(best.model),
      alternatives: alternatives.map(a => ({ model: a.model, score: a.score })),
    }
  }

  // Retorna o tier efetivo considerando operações críticas
  resolveTier(ctx: SelectionContext): Tier {
    if (ctx.operation && CRITICAL_OPERATIONS.has(ctx.operation)) return 3
    return ctx.tier
  }

  // ─── Filtragem ──────────────────────────────────────────────────────────────

  private filterCandidates(ctx: SelectionContext): Model[] {
    const tier = this.resolveTier(ctx)

    return this.models.filter(m => {
      // Tier mínimo
      if (m.tierCapability < tier) return false

      // ── BYOK gate ──────────────────────────────────────────────────────────
      // Regra de segurança crítica para multi-tenant: um modelo PAGO só pode
      // ser usado se o usuário atual configurou sua PRÓPRIA key para aquele
      // provider. Modelos gratuitos/locais ficam sempre disponíveis pois usam
      // a key padrão da plataforma — custo zero, nenhum risco de um usuário
      // consumir a assinatura paga de outro.
      const isPlatformFree = m.hasFreeTier || m.isLocal
      const userHasOwnKey  = ctx.userProviders?.includes(m.provider) ?? false
      if (!isPlatformFree && !userHasOwnKey) return false

      // Forçar gratuito
      if (ctx.preferFreeTier && !m.hasFreeTier && !m.isLocal) return false

      // Forçar local (Ollama)
      if (ctx.preferLocal && !m.isLocal) return false

      // Excluir origens (ex: compliance)
      if (ctx.excludeOrigins?.includes(m.origin)) return false

      // Budget: estima custo médio e filtra se ultrapassar budget restante
      if (ctx.budgetRemainingUsd !== undefined) {
        const estimated = this.estimateCost(m)
        if (estimated > ctx.budgetRemainingUsd) return false
      }

      return true
    })
  }

  // ─── Scoring ────────────────────────────────────────────────────────────────

  private score(model: Model, ctx: SelectionContext): number {
    const tier        = this.resolveTier(ctx)
    const profile     = STAGE_PROFILES[ctx.stage]
    const history     = this.getHistory(model.id, ctx.stage, ctx.operation)
    const allCosts    = this.models.map(m => m.costOutputPer1M)
    const maxCost     = Math.max(...allCosts) || 1

    const tierScore       = this.scoreTier(model, tier)
    const strengthScore   = this.scoreStrength(model, ctx)
    const performanceScore = history
      ? history.performanceScore
      : 0.5  // prior neutro se não há histórico
    const costScore       = this.scoreCost(model, maxCost)
    const latencyScore    = this.scoreLatency(model, profile.latencyRequirement)

    return (
      this.weights.tier        * tierScore        +
      this.weights.strength    * strengthScore    +
      this.weights.performance * performanceScore +
      this.weights.cost        * costScore        +
      this.weights.latency     * latencyScore
    )
  }

  // Tier: penaliza modelos com tier muito acima do necessário (custo desnecessário)
  private scoreTier(model: Model, requiredTier: Tier): number {
    const diff = model.tierCapability - requiredTier
    if (diff < 0) return 0          // abaixo do mínimo — não deve chegar aqui
    if (diff === 0) return 1.0      // fit perfeito
    if (diff === 1) return 0.6      // um tier acima — aceitável
    return 0.3                      // dois tiers acima — caro demais
  }

  // Força: overlap entre strengths do modelo e as requeridas pela etapa/dimensão
  private scoreStrength(model: Model, ctx: SelectionContext): number {
    let required: ModelStrength[]

    if (ctx.stage === 'quality_council' && ctx.qualityDimension) {
      required = QUALITY_DIMENSION_STRENGTHS[ctx.qualityDimension]
    } else {
      required = STAGE_PROFILES[ctx.stage].preferredStrengths
    }

    if (required.length === 0) return 0.5

    const matches = required.filter(s => model.strengths.includes(s)).length
    return matches / required.length
  }

  // Custo: normalizado inversamente (mais barato = score maior)
  private scoreCost(model: Model, maxCost: number): number {
    if (model.isLocal || model.hasFreeTier) return 1.0
    return 1 - (model.costOutputPer1M / maxCost)
  }

  // Latência: match com o perfil da etapa
  private scoreLatency(model: Model, required: LatencyProfile): number {
    const order: Record<LatencyProfile, number> = { fast: 0, medium: 1, slow: 2 }
    const diff = Math.abs(order[model.latencyProfile] - order[required])
    return diff === 0 ? 1.0 : diff === 1 ? 0.6 : 0.2
  }

  // ─── Utilitários ────────────────────────────────────────────────────────────

  private getHistory(
    modelId: string,
    stage: Stage,
    operation?: string
  ): PerformanceRecord | undefined {
    return this.performanceHistory.find(
      h =>
        h.modelId === modelId &&
        h.stage === stage &&
        h.operation === (operation ?? undefined)
    )
  }

  // Estimativa de custo por chamada (assume ~2k tokens output médio)
  private estimateCost(model: Model): number {
    if (model.isLocal || model.hasFreeTier) return 0
    const AVG_INPUT_TOKENS  = 4_000
    const AVG_OUTPUT_TOKENS = 2_000
    return (
      (AVG_INPUT_TOKENS  / 1_000_000) * model.costInputPer1M +
      (AVG_OUTPUT_TOKENS / 1_000_000) * model.costOutputPer1M
    )
  }

  private buildReason(model: Model, ctx: SelectionContext): string {
    const tier      = this.resolveTier(ctx)
    const history   = this.getHistory(model.id, ctx.stage, ctx.operation)
    const isFree    = model.isLocal || model.hasFreeTier
    const costLabel = isFree ? 'gratuito' : `$${model.costOutputPer1M}/M output`
    const histLabel = history
      ? `${Math.round((history.humanApprovals / (history.totalCalls || 1)) * 100)}% de aprovação humana`
      : 'sem histórico (prior neutro)'

    return [
      `Tier ${model.tierCapability} (requerido: ${tier}).`,
      `Forças: ${model.strengths.join(', ')}.`,
      `Custo: ${costLabel}.`,
      `Histórico nesta etapa: ${histLabel}.`,
    ].join(' ')
  }

  // ─── Progressive Escalation ─────────────────────────────────────────────────
  // Tenta no tier informado; se auto-crítica falhar, sobe um tier e re-seleciona

  selectWithEscalation(
    ctx: SelectionContext,
    selfCritiqueScore: number,   // 0-1, retornado após execução
    threshold = 0.7
  ): SelectionResult | null {
    if (selfCritiqueScore >= threshold) return null  // aprovado, sem escalação

    const nextTier = Math.min(ctx.tier + 1, 3) as Tier
    if (nextTier === ctx.tier) return null            // já está no Tier 3

    console.log(
      `[ModelSelector] Escalando de Tier ${ctx.tier} → Tier ${nextTier} ` +
      `(score: ${selfCritiqueScore.toFixed(2)} < ${threshold})`
    )

    return this.select({ ...ctx, tier: nextTier })
  }

  // ─── Quality Council ────────────────────────────────────────────────────────
  // Seleciona um modelo por dimensão e retorna um mapa para execução paralela

  selectForQualityCouncil(
    baseTier: Tier,
    opts?: Pick<SelectionContext, 'budgetRemainingUsd' | 'excludeOrigins' | 'preferFreeTier'>
  ): Record<QualityDimension, SelectionResult> {
    const dimensions: QualityDimension[] = [
      'security', 'performance', 'seo', 'a11y', 'best_practices',
    ]

    return Object.fromEntries(
      dimensions.map(dim => {
        // Segurança sempre Tier 3; SEO e boas práticas podem ir a Tier 1
        const tierOverride: Record<QualityDimension, Tier> = {
          security:       3,
          performance:    2,
          seo:            1,
          a11y:           2,
          best_practices: 1,
        }

        const result = this.select({
          stage: 'quality_council',
          tier: Math.max(baseTier, tierOverride[dim]) as Tier,
          qualityDimension: dim,
          ...opts,
        })

        return [dim, result]
      })
    ) as Record<QualityDimension, SelectionResult>
  }

  // ─── Performance Update ──────────────────────────────────────────────────────
  // Chamado após cada gate humano para atualizar o histórico

  updatePerformance(
    modelId: string,
    stage: Stage,
    operation: string | undefined,
    approved: boolean,
    selfCritiqueScore: number,
    costUsd: number,
    latencyMs: number
  ): PerformanceRecord {
    const existing = this.getHistory(modelId, stage, operation)

    if (existing) {
      existing.totalCalls++
      if (approved) existing.humanApprovals++
      else existing.humanRejections++
      existing.avgSelfCritiqueScore = this.rollingAvg(
        existing.avgSelfCritiqueScore, selfCritiqueScore, existing.totalCalls
      )
      existing.avgCostUsd   = this.rollingAvg(existing.avgCostUsd, costUsd, existing.totalCalls)
      existing.avgLatencyMs = this.rollingAvg(existing.avgLatencyMs, latencyMs, existing.totalCalls)
      existing.performanceScore = this.calcPerformanceScore(existing)
      return existing
    }

    const record: PerformanceRecord = {
      modelId,
      stage,
      operation,
      totalCalls: 1,
      humanApprovals:   approved ? 1 : 0,
      humanRejections:  approved ? 0 : 1,
      avgSelfCritiqueScore: selfCritiqueScore,
      avgCostUsd: costUsd,
      avgLatencyMs: latencyMs,
      performanceScore: approved ? 0.75 : 0.25,
    }

    this.performanceHistory.push(record)
    return record
  }

  // Score composto: 60% aprovação humana + 30% auto-crítica + 10% custo
  private calcPerformanceScore(r: PerformanceRecord): number {
    const approvalRate    = r.humanApprovals / Math.max(r.totalCalls, 1)
    const selfCritiqueNorm = r.avgSelfCritiqueScore  // já 0-1
    const costNorm         = Math.max(0, 1 - r.avgCostUsd / 0.10)  // normaliza até $0.10

    return 0.60 * approvalRate + 0.30 * selfCritiqueNorm + 0.10 * costNorm
  }

  private rollingAvg(prev: number, next: number, n: number): number {
    return (prev * (n - 1) + next) / n
  }

  // ─── Debug / Observabilidade ─────────────────────────────────────────────────

  explain(ctx: SelectionContext): void {
    const candidates = this.filterCandidates(ctx)
    const scored     = candidates
      .map(m => ({ model: m, score: this.score(m, ctx) }))
      .sort((a, b) => b.score - a.score)

    console.log(`\n── ModelSelector.explain ──────────────────────────`)
    console.log(`Stage: ${ctx.stage} | Operation: ${ctx.operation ?? '-'} | Tier: ${ctx.tier}`)
    console.log(`Candidates: ${candidates.length} / ${this.models.length} modelos ativos\n`)

    scored.slice(0, 6).forEach(({ model, score }, i) => {
      const free = model.isLocal ? '🏠 local' : model.hasFreeTier ? '🆓 free' : `💰 $${model.costOutputPer1M}/M`
      console.log(`${i + 1}. [${score.toFixed(3)}] ${model.displayName} (${model.provider}) ${free}`)
    })
    console.log('────────────────────────────────────────────────────\n')
  }
}

// ─── Default Registry ─────────────────────────────────────────────────────────
// Modelos pré-configurados — espelho do seed SQL

export const DEFAULT_MODELS: Model[] = [
  // ── Tier 1 ──
  {
    id: 'gemini-2.5-flash', name: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash', provider: 'google',
    modelId: 'gemini-2.5-flash', isDefault: true, isActive: true, isLocal: false,
    tierCapability: 1, contextWindow: 1_000_000,
    strengths: ['analysis', 'multilingual'],
    costInputPer1M: 0.075, costOutputPer1M: 0.30,
    hasFreeTier: true, freeTierRpd: 1500,
    latencyProfile: 'fast', origin: 'western', license: 'proprietary',
  },
  {
    id: 'gemini-flash-lite', name: 'gemini-flash-lite',
    displayName: 'Gemini Flash-Lite', provider: 'google',
    modelId: 'gemini-2.5-flash-lite', isDefault: true, isActive: true, isLocal: false,
    tierCapability: 1, contextWindow: 1_000_000,
    strengths: ['analysis'],
    costInputPer1M: 0.01, costOutputPer1M: 0.04,
    hasFreeTier: true, freeTierRpd: 1500,
    latencyProfile: 'fast', origin: 'western', license: 'proprietary',
  },
  {
    id: 'glm-4.7-flash', name: 'glm-4.7-flash',
    displayName: 'GLM-4.7 Flash', provider: 'glm',
    modelId: 'glm-4.7-flash', isDefault: true, isActive: true, isLocal: false,
    tierCapability: 1, contextWindow: 128_000,
    strengths: ['coding', 'agentic'],
    costInputPer1M: 0, costOutputPer1M: 0,
    hasFreeTier: true,
    latencyProfile: 'fast', origin: 'chinese', license: 'proprietary',
  },
  {
    id: 'qwen-flash', name: 'qwen-flash',
    displayName: 'Qwen Flash', provider: 'qwen',
    modelId: 'qwen-turbo', isDefault: true, isActive: true, isLocal: false,
    tierCapability: 1, contextWindow: 1_000_000,
    strengths: ['multilingual', 'coding'],
    costInputPer1M: 0.05, costOutputPer1M: 0.15,
    hasFreeTier: true,
    latencyProfile: 'fast', origin: 'chinese', license: 'proprietary',
  },
  {
    id: 'deepseek-v4-flash', name: 'deepseek-v4-flash',
    displayName: 'DeepSeek V4 Flash', provider: 'deepseek',
    modelId: 'deepseek-v4-flash', isDefault: true, isActive: true, isLocal: false,
    tierCapability: 1, contextWindow: 1_000_000,
    strengths: ['coding', 'reasoning'],
    costInputPer1M: 0.14, costOutputPer1M: 0.28,
    hasFreeTier: true,
    latencyProfile: 'fast', origin: 'chinese', license: 'MIT',
  },
  {
    id: 'gemma-4-26b', name: 'gemma-4-26b',
    displayName: 'Gemma 4 26B (local)', provider: 'ollama',
    modelId: 'gemma4:26b', isDefault: true, isActive: true, isLocal: true,
    tierCapability: 1, contextWindow: 256_000,
    strengths: ['analysis', 'coding'],
    costInputPer1M: 0, costOutputPer1M: 0,
    hasFreeTier: true,
    latencyProfile: 'medium', origin: 'open-source', license: 'Apache-2.0',
  },
  // ── Tier 2 ──
  {
    id: 'deepseek-v4-pro', name: 'deepseek-v4-pro',
    displayName: 'DeepSeek V4 Pro', provider: 'deepseek',
    modelId: 'deepseek-v4-pro', isDefault: true, isActive: true, isLocal: false,
    tierCapability: 2, contextWindow: 1_000_000,
    strengths: ['coding', 'reasoning', 'agentic'],
    costInputPer1M: 0.50, costOutputPer1M: 1.50,
    hasFreeTier: false,
    latencyProfile: 'medium', origin: 'chinese', license: 'MIT',
  },
  {
    id: 'minimax-m3', name: 'minimax-m3',
    displayName: 'MiniMax M3', provider: 'minimax',
    modelId: 'minimax-m3', isDefault: true, isActive: true, isLocal: false,
    tierCapability: 2, contextWindow: 1_000_000,
    strengths: ['coding', 'analysis'],
    costInputPer1M: 0.30, costOutputPer1M: 1.20,
    hasFreeTier: false,
    latencyProfile: 'medium', origin: 'chinese', license: 'proprietary',
  },
  {
    id: 'qwen-3.6-plus', name: 'qwen-3.6-plus',
    displayName: 'Qwen 3.6 Plus', provider: 'qwen',
    modelId: 'qwen3.6-plus', isDefault: true, isActive: true, isLocal: false,
    tierCapability: 2, contextWindow: 1_000_000,
    strengths: ['agentic', 'multilingual', 'coding'],
    costInputPer1M: 0.50, costOutputPer1M: 1.50,
    hasFreeTier: false,
    latencyProfile: 'medium', origin: 'chinese', license: 'proprietary',
  },
  {
    id: 'claude-sonnet-4.6', name: 'claude-sonnet-4.6',
    displayName: 'Claude Sonnet 4.6', provider: 'anthropic',
    modelId: 'claude-sonnet-4-6', isDefault: true, isActive: true, isLocal: false,
    tierCapability: 2, contextWindow: 1_000_000,
    strengths: ['coding', 'creative', 'analysis'],
    costInputPer1M: 3.00, costOutputPer1M: 15.0,
    hasFreeTier: false,
    latencyProfile: 'medium', origin: 'western', license: 'proprietary',
  },
  {
    id: 'kimi-k2.6', name: 'kimi-k2.6',
    displayName: 'Kimi K2.6', provider: 'moonshot',
    modelId: 'kimi-k2.6', isDefault: true, isActive: true, isLocal: false,
    tierCapability: 2, contextWindow: 262_000,
    strengths: ['agentic', 'coding'],
    costInputPer1M: 1.00, costOutputPer1M: 3.00,
    hasFreeTier: false,
    latencyProfile: 'medium', origin: 'chinese', license: 'MIT',
  },
  {
    id: 'gemini-3.1-flash', name: 'gemini-3.1-flash',
    displayName: 'Gemini 3.1 Flash', provider: 'google',
    modelId: 'gemini-3.1-flash', isDefault: true, isActive: true, isLocal: false,
    tierCapability: 2, contextWindow: 1_000_000,
    strengths: ['analysis', 'coding'],
    costInputPer1M: 0.10, costOutputPer1M: 0.40,
    hasFreeTier: false,
    latencyProfile: 'fast', origin: 'western', license: 'proprietary',
  },
  // ── Tier 3 ──
  {
    id: 'claude-opus-4.8', name: 'claude-opus-4.8',
    displayName: 'Claude Opus 4.8', provider: 'anthropic',
    modelId: 'claude-opus-4-8', isDefault: true, isActive: true, isLocal: false,
    tierCapability: 3, contextWindow: 1_000_000,
    strengths: ['reasoning', 'security', 'coding'],
    costInputPer1M: 5.00, costOutputPer1M: 25.0,
    hasFreeTier: false,
    latencyProfile: 'slow', origin: 'western', license: 'proprietary',
  },
  {
    id: 'gpt-5.5', name: 'gpt-5.5',
    displayName: 'GPT-5.5', provider: 'openai',
    modelId: 'gpt-5.5', isDefault: true, isActive: true, isLocal: false,
    tierCapability: 3, contextWindow: 1_000_000,
    strengths: ['reasoning', 'coding', 'security'],
    costInputPer1M: 5.00, costOutputPer1M: 30.0,
    hasFreeTier: false,
    latencyProfile: 'slow', origin: 'western', license: 'proprietary',
  },
  {
    id: 'deepseek-v4-pro-max', name: 'deepseek-v4-pro-max',
    displayName: 'DeepSeek V4 Pro Max', provider: 'deepseek',
    modelId: 'deepseek-v4-pro-max', isDefault: true, isActive: true, isLocal: false,
    tierCapability: 3, contextWindow: 1_000_000,
    strengths: ['coding', 'reasoning', 'security'],
    costInputPer1M: 1.74, costOutputPer1M: 3.48,
    hasFreeTier: false,
    latencyProfile: 'medium', origin: 'chinese', license: 'MIT',
  },
  {
    id: 'glm-5.1', name: 'glm-5.1',
    displayName: 'GLM-5.1', provider: 'glm',
    modelId: 'glm-5.1', isDefault: true, isActive: true, isLocal: false,
    tierCapability: 3, contextWindow: 200_000,
    strengths: ['coding', 'agentic', 'security'],
    costInputPer1M: 5.00, costOutputPer1M: 20.0,
    hasFreeTier: false,
    latencyProfile: 'slow', origin: 'chinese', license: 'MIT',
  },
  {
    id: 'qwen-3.6-max', name: 'qwen-3.6-max',
    displayName: 'Qwen 3.6 Max', provider: 'qwen',
    modelId: 'qwen3.6-max', isDefault: true, isActive: true, isLocal: false,
    tierCapability: 3, contextWindow: 1_000_000,
    strengths: ['agentic', 'coding', 'reasoning'],
    costInputPer1M: 3.00, costOutputPer1M: 9.00,
    hasFreeTier: false,
    latencyProfile: 'medium', origin: 'chinese', license: 'proprietary',
  },
  {
    id: 'gemini-3.1-pro', name: 'gemini-3.1-pro',
    displayName: 'Gemini 3.1 Pro', provider: 'google',
    modelId: 'gemini-3.1-pro', isDefault: true, isActive: true, isLocal: false,
    tierCapability: 3, contextWindow: 1_000_000,
    strengths: ['reasoning', 'analysis'],
    costInputPer1M: 2.00, costOutputPer1M: 12.0,
    hasFreeTier: false,
    latencyProfile: 'medium', origin: 'western', license: 'proprietary',
  },
]

// ─── Instância padrão exportada ───────────────────────────────────────────────

export function createSelector(
  customModels: Model[] = [],
  performanceHistory: PerformanceRecord[] = [],
  weights?: Partial<SelectorWeights>
): ModelSelector {
  const allModels = [
    ...DEFAULT_MODELS,
    ...customModels.map(m => ({ ...m, isDefault: false })),
  ]
  return new ModelSelector(allModels, performanceHistory, weights)
}

// ─── Exemplo de uso ───────────────────────────────────────────────────────────

if (require.main === module) {
  const selector = createSelector()

  console.log('\n═══ DevFactory — Model Selector Demo ═══\n')

  // 1. Seleção simples: backend auth (operação crítica → forçado Tier 3)
  const authResult = selector.select({
    stage: 'backend',
    operation: 'auth',
    tier: 2,
  })
  console.log('📦 Backend > auth (operação crítica):')
  console.log(`   → ${authResult.model.displayName} (score: ${authResult.score.toFixed(3)})`)
  console.log(`   → ${authResult.reason}\n`)

  // 2. Docs final com free tier forçado
  const docsResult = selector.select({
    stage: 'docs_final',
    tier: 1,
    preferFreeTier: true,
  })
  console.log('📄 Docs Final (somente gratuitos):')
  console.log(`   → ${docsResult.model.displayName} (${docsResult.model.provider})`)
  console.log(`   → Custo estimado: $${docsResult.estimatedCostUsd.toFixed(6)}\n`)

  // 3. Quality Council — todos em paralelo
  const qcResults = selector.selectForQualityCouncil(2)
  console.log('🛡️  Quality Council (paralelo):')
  Object.entries(qcResults).forEach(([dim, result]) => {
    console.log(`   ${dim.padEnd(16)} → ${result.model.displayName}`)
  })

  // 4. Debug detalhado de candidatos
  console.log('')
  selector.explain({ stage: 'backend', operation: 'crud', tier: 1 })
}
