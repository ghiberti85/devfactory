/**
 * DevFactory — Complexity Router
 *
 * Meta-agente que avalia cada operação antes da execução e retorna o Tier
 * correto (1, 2 ou 3) para o Model Selector.
 *
 * Usa modelos gratuitos/baratos (Gemini Flash-Lite ou GLM-4.7-Flash)
 * para manter custo próximo de zero nessa camada.
 *
 * Fluxo:
 *   describe(operation) → RouterInput
 *     → [LLM barato avalia 3 dimensões]
 *       → RouterOutput { tier, scores, reason, confidence }
 *         → ModelSelector.select({ tier })
 */

import type { Stage, Tier } from './model-selector'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RouterInput {
  stage: Stage
  operation: string          // descrição curta da operação
  spec?: string              // spec técnica ou contexto adicional (opcional)
  codebaseContext?: string   // padrões existentes no projeto (opcional)
}

export interface DimensionScore {
  score: number        // 0.0 – 1.0
  rationale: string    // justificativa curta em PT-BR
}

export interface RouterOutput {
  tier: Tier
  confidence: number   // 0.0 – 1.0 (quão certo o router está)
  dimensions: {
    ambiguity:    DimensionScore  // quão ambígua/incompleta é a spec
    criticality:  DimensionScore  // qual o impacto se errar
    novelty:      DimensionScore  // quão diferente dos padrões existentes
  }
  reason: string       // resumo da decisão em PT-BR
  escalationHint: string | null  // sugestão se o resultado vier fraco
}

// Schema que o LLM deve retornar (JSON puro)
interface LLMRouterSchema {
  ambiguity_score:   number
  ambiguity_reason:  string
  criticality_score: number
  criticality_reason: string
  novelty_score:     number
  novelty_reason:    string
  tier:              1 | 2 | 3
  confidence:        number
  reason:            string
  escalation_hint:   string | null
}

// ─── Prompts ──────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `
Você é o Complexity Router do DevFactory, um sistema de desenvolvimento de software autônomo.

Sua única função é avaliar a complexidade de uma operação de desenvolvimento e retornar
o tier de modelo de IA que deve executá-la. Você DEVE responder APENAS com JSON válido,
sem texto antes ou depois, sem blocos markdown.

## Tiers disponíveis
- Tier 1: operações simples, previsíveis, boilerplate. Modelos baratos/gratuitos.
- Tier 2: feature dev padrão, lógica moderada, integração de sistemas. Modelos mid-tier.
- Tier 3: decisões críticas, segurança, arquitetura, alta ambiguidade. Modelos frontier.

## Dimensões de avaliação (cada uma de 0.0 a 1.0)

AMBIGUIDADE (ambiguity_score):
  0.0 = spec completamente clara, formato bem definido, output previsível
  0.5 = spec parcialmente clara, algumas decisões a tomar
  1.0 = spec vaga, muitas decisões abertas, output imprevisível

CRITICIDADE (criticality_score):
  0.0 = erro não causa dano (ex: renomear variável, doc interna)
  0.5 = erro causa retrabalho moderado (ex: componente UI, endpoint CRUD)
  1.0 = erro causa falha de segurança, perda de dados ou falha sistêmica

NOVIDADE (novelty_score):
  0.0 = padrão já existe no codebase, é só replicar
  0.5 = existe padrão similar mas precisa de adaptação
  1.0 = decisão completamente nova, sem precedente no projeto

## Regra de mapeamento para tier

score_final = (ambiguity * 0.35) + (criticality * 0.45) + (novelty * 0.20)

score_final < 0.30  → tier 1
score_final < 0.60  → tier 2
score_final >= 0.60 → tier 3

EXCEÇÃO ABSOLUTA: se criticality_score >= 0.85, tier é SEMPRE 3, independente do score_final.

## Formato de saída obrigatório

{
  "ambiguity_score": <number 0.0-1.0>,
  "ambiguity_reason": "<string curta em PT-BR>",
  "criticality_score": <number 0.0-1.0>,
  "criticality_reason": "<string curta em PT-BR>",
  "novelty_score": <number 0.0-1.0>,
  "novelty_reason": "<string curta em PT-BR>",
  "tier": <1|2|3>,
  "confidence": <number 0.0-1.0>,
  "reason": "<resumo da decisão em PT-BR, 1-2 frases>",
  "escalation_hint": "<string ou null — sugestão caso o modelo precise escalar>"
}
`.trim()

function buildUserPrompt(input: RouterInput): string {
  const lines = [
    `Stage: ${input.stage}`,
    `Operação: ${input.operation}`,
  ]

  if (input.spec) {
    lines.push(`\nSpec técnica:\n${input.spec.slice(0, 800)}`)
  }

  if (input.codebaseContext) {
    lines.push(`\nContexto do codebase (padrões existentes):\n${input.codebaseContext.slice(0, 400)}`)
  }

  return lines.join('\n')
}

// ─── Provider adapters ────────────────────────────────────────────────────────
// Abstrai chamadas para diferentes providers — todos OpenAI-compatible exceto Anthropic

export type RouterProvider = 'google' | 'glm' | 'groq' | 'openrouter' | 'anthropic'

interface ProviderConfig {
  provider:  RouterProvider
  apiKey:    string
  modelId:   string
  baseUrl?:  string
}

const PROVIDER_DEFAULTS: Record<RouterProvider, { baseUrl: string; defaultModel: string }> = {
  google:     { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.5-flash-lite' },
  glm:        { baseUrl: 'https://open.bigmodel.cn/api/paas/v4',                   defaultModel: 'glm-4.7-flash' },
  groq:       { baseUrl: 'https://api.groq.com/openai/v1',                         defaultModel: 'llama-3.3-70b-versatile' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1',                            defaultModel: 'google/gemini-2.5-flash-lite' },
  anthropic:  { baseUrl: 'https://api.anthropic.com/v1',                            defaultModel: 'claude-haiku-4-5-20251001' },
}

async function callProvider(
  config: ProviderConfig,
  userMessage: string
): Promise<string> {
  const defaults = PROVIDER_DEFAULTS[config.provider]
  const baseUrl  = config.baseUrl ?? defaults.baseUrl
  const modelId  = config.modelId ?? defaults.defaultModel

  // Anthropic usa endpoint nativo (não OpenAI-compatible)
  if (config.provider === 'anthropic') {
    const res = await fetch(`${baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      modelId,
        max_tokens: 1024,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: 'user', content: userMessage }],
      }),
    })
    if (!res.ok) throw new Error(`Anthropic error: ${res.status} ${await res.text()}`)
    const data = await res.json()
    return data.content?.[0]?.text ?? ''
  }

  // OpenAI-compatible (Google, GLM, Groq, OpenRouter)
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model:       modelId,
      max_tokens:  1024,
      temperature: 0.1,   // baixíssima temperatura — queremos output determinístico
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMessage },
      ],
    }),
  })

  if (!res.ok) throw new Error(`${config.provider} error: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return data.choices?.[0]?.message?.content ?? ''
}

// ─── JSON parser robusto ──────────────────────────────────────────────────────

function parseRouterJSON(raw: string): LLMRouterSchema {
  // Remove blocos markdown caso o modelo desobedeça
  const cleaned = raw
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g,      '')
    .trim()

  // Tenta extrair JSON mesmo com texto ao redor
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (!match) throw new Error(`RouterOutput: JSON não encontrado na resposta.\nRaw: ${raw.slice(0, 200)}`)

  const parsed = JSON.parse(match[0]) as LLMRouterSchema

  // Validações mínimas
  if (![1, 2, 3].includes(parsed.tier)) {
    throw new Error(`RouterOutput: tier inválido "${parsed.tier}"`)
  }
  if (typeof parsed.confidence !== 'number') {
    parsed.confidence = 0.5
  }

  return parsed
}

// ─── Fallback heurístico ──────────────────────────────────────────────────────
// Usado quando a chamada ao LLM falha — garante que o pipeline não trava

const HEURISTIC_TIER_3_KEYWORDS = [
  'auth', 'autenticação', 'segurança', 'security', 'criptografia',
  'encryption', 'token', 'jwt', 'oauth', 'schema', 'migração',
  'migration', 'arquitetura', 'architecture', 'prd', 'planejamento',
  'risco', 'risk', 'payment', 'pagamento',
]

const HEURISTIC_TIER_1_KEYWORDS = [
  'readme', 'changelog', 'comentário', 'comment', 'renomear', 'rename',
  'formatação', 'format', 'lint', 'seo meta', 'favicon', 'boilerplate',
  'mock', 'fixture', 'stub',
]

function heuristicTier(input: RouterInput): RouterOutput {
  const text = `${input.stage} ${input.operation} ${input.spec ?? ''}`.toLowerCase()

  let tier: Tier = 2

  if (HEURISTIC_TIER_3_KEYWORDS.some(kw => text.includes(kw))) {
    tier = 3
  } else if (HEURISTIC_TIER_1_KEYWORDS.some(kw => text.includes(kw))) {
    tier = 1
  }

  return {
    tier,
    confidence: 0.4,
    dimensions: {
      ambiguity:   { score: 0.5, rationale: 'Avaliação heurística — LLM indisponível.' },
      criticality: { score: 0.5, rationale: 'Avaliação heurística — LLM indisponível.' },
      novelty:     { score: 0.5, rationale: 'Avaliação heurística — LLM indisponível.' },
    },
    reason: `Fallback heurístico (LLM indisponível). Tier ${tier} por keyword match.`,
    escalationHint: 'Revisar manualmente — avaliação sem LLM.',
  }
}

// ─── Complexity Router ────────────────────────────────────────────────────────

export interface RouterOptions {
  provider:         RouterProvider
  apiKey:           string
  modelId?:         string
  baseUrl?:         string
  timeoutMs?:       number   // default: 10_000
  retries?:         number   // default: 2
  fallbackToHeuristic?: boolean  // default: true
}

export class ComplexityRouter {
  private config:   ProviderConfig
  private timeout:  number
  private retries:  number
  private useFallback: boolean

  // Cache simples em memória: evita rechamar o LLM para operações idênticas
  private cache = new Map<string, RouterOutput>()

  constructor(opts: RouterOptions) {
    this.config = {
      provider: opts.provider,
      apiKey:   opts.apiKey,
      modelId:  opts.modelId ?? PROVIDER_DEFAULTS[opts.provider].defaultModel,
      baseUrl:  opts.baseUrl,
    }
    this.timeout     = opts.timeoutMs ?? 10_000
    this.retries     = opts.retries   ?? 2
    this.useFallback = opts.fallbackToHeuristic ?? true
  }

  // ── Método principal ────────────────────────────────────────────────────────

  async route(input: RouterInput): Promise<RouterOutput> {
    const cacheKey = this.cacheKey(input)
    if (this.cache.has(cacheKey)) {
      console.log(`[ComplexityRouter] Cache hit: "${input.operation}"`)
      return this.cache.get(cacheKey)!
    }

    const userPrompt = buildUserPrompt(input)
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const raw    = await this.callWithTimeout(userPrompt)
        const parsed = parseRouterJSON(raw)
        const output = this.toRouterOutput(parsed)

        this.cache.set(cacheKey, output)
        this.log(input, output)
        return output

      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        console.warn(`[ComplexityRouter] Tentativa ${attempt + 1} falhou: ${lastError.message}`)

        if (attempt < this.retries) {
          await this.sleep(300 * (attempt + 1))
        }
      }
    }

    // Todas as tentativas falharam
    if (this.useFallback) {
      console.warn('[ComplexityRouter] Usando fallback heurístico.')
      const fallback = heuristicTier(input)
      this.cache.set(cacheKey, fallback)
      return fallback
    }

    throw lastError ?? new Error('ComplexityRouter: falha desconhecida')
  }

  // ── Roteamento em batch ─────────────────────────────────────────────────────
  // Para Quality Council: avalia todas as dimensões em paralelo

  async routeBatch(inputs: RouterInput[]): Promise<RouterOutput[]> {
    return Promise.all(inputs.map(i => this.route(i)))
  }

  // ── Utilitários ─────────────────────────────────────────────────────────────

  private async callWithTimeout(prompt: string): Promise<string> {
    return Promise.race([
      callProvider(this.config, prompt),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout após ${this.timeout}ms`)), this.timeout)
      ),
    ])
  }

  private toRouterOutput(p: LLMRouterSchema): RouterOutput {
    return {
      tier:       p.tier,
      confidence: Math.min(1, Math.max(0, p.confidence)),
      dimensions: {
        ambiguity: {
          score:     Math.min(1, Math.max(0, p.ambiguity_score)),
          rationale: p.ambiguity_reason,
        },
        criticality: {
          score:     Math.min(1, Math.max(0, p.criticality_score)),
          rationale: p.criticality_reason,
        },
        novelty: {
          score:     Math.min(1, Math.max(0, p.novelty_score)),
          rationale: p.novelty_reason,
        },
      },
      reason:          p.reason,
      escalationHint:  p.escalation_hint,
    }
  }

  private cacheKey(input: RouterInput): string {
    return `${input.stage}::${input.operation}::${(input.spec ?? '').slice(0, 100)}`
  }

  private log(input: RouterInput, output: RouterOutput): void {
    const conf   = (output.confidence * 100).toFixed(0)
    const scores = output.dimensions
    console.log(
      `[ComplexityRouter] "${input.operation}" → Tier ${output.tier} ` +
      `(conf: ${conf}% | amb: ${scores.ambiguity.score.toFixed(2)} ` +
      `crit: ${scores.criticality.score.toFixed(2)} ` +
      `nov: ${scores.novelty.score.toFixed(2)})`
    )
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // Limpa cache (útil entre projetos ou ao atualizar specs)
  clearCache(): void {
    this.cache.clear()
  }
}

// ─── Factory helper ───────────────────────────────────────────────────────────

export function createRouter(opts: RouterOptions): ComplexityRouter {
  return new ComplexityRouter(opts)
}

// ─── Integração com ModelSelector ─────────────────────────────────────────────
// Função de conveniência que encadeia Router → Selector

import { ModelSelector, type SelectionContext, type SelectionResult } from './model-selector'

export async function routeAndSelect(
  router:   ComplexityRouter,
  selector: ModelSelector,
  input:    RouterInput,
  ctxOverrides?: Partial<Omit<SelectionContext, 'stage' | 'tier'>>
): Promise<{ routerOutput: RouterOutput; selectionResult: SelectionResult }> {
  const routerOutput = await router.route(input)

  const selectionResult = selector.select({
    stage:     input.stage,
    operation: input.operation,
    tier:      routerOutput.tier,
    ...ctxOverrides,
  })

  return { routerOutput, selectionResult }
}

// ─── Exemplo de uso ───────────────────────────────────────────────────────────

if (require.main === module) {
  ;(async () => {
    // Simula o router sem chamar API real — usa fallback heurístico
    const router = createRouter({
      provider:             'google',
      apiKey:               'SEM_KEY_DEMO',
      fallbackToHeuristic:  true,
    })

    const cases: RouterInput[] = [
      { stage: 'backend',      operation: 'implementar sistema de autenticação JWT com refresh token' },
      { stage: 'frontend',     operation: 'criar componente Button com variantes size e variant' },
      { stage: 'docs_final',   operation: 'atualizar README com instruções de deploy' },
      { stage: 'backend',      operation: 'endpoint CRUD para listagem de produtos' },
      { stage: 'planning',     operation: 'gerar PRD completo para sistema de pagamentos' },
      { stage: 'tests',        operation: 'gerar mocks e fixtures para testes de unit' },
      { stage: 'quality_council', operation: 'análise de segurança OWASP Top 10' },
    ]

    console.log('\n═══ DevFactory — Complexity Router Demo ═══\n')

    for (const input of cases) {
      const output = await router.route(input)
      const bar    = '█'.repeat(output.tier) + '░'.repeat(3 - output.tier)
      console.log(`[T${output.tier}] ${bar}  ${input.operation.slice(0, 55).padEnd(55)}  conf: ${(output.confidence * 100).toFixed(0)}%`)
    }

    console.log('\n── Detalhes do caso crítico ──')
    const critical = await router.route({
      stage:     'backend',
      operation: 'implementar sistema de autenticação JWT com refresh token',
      spec:      'Usar RS256, refresh token rotation, blacklist em Redis, PKCE para mobile.',
    })
    console.log(JSON.stringify(critical, null, 2))
  })()
}
