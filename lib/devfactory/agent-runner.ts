/**
 * DevFactory — Agent Runner
 *
 * Executa chamadas reais aos modelos selecionados pelo Model Selector.
 * Suporta streaming via AsyncIterator, multi-provider (OpenAI-compatible + Anthropic),
 * retry com backoff exponencial e output estruturado em JSON.
 *
 * Interface implementada:
 *   AgentRunner.run(params) → Promise<unknown>   (output estruturado)
 *   AgentRunner.stream(params) → AsyncIterable   (tokens em tempo real)
 */

import type { PipelineStage, SSEEvent } from './types'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentRunParams {
  stage:           PipelineStage
  operation:       string
  modelId:         string          // ex: 'claude-sonnet-4-6', 'deepseek-v4-flash'
  provider:        AgentProvider
  apiKey:          string
  baseUrl?:        string          // para providers custom/Ollama
  systemPrompt:    string
  userPrompt:      string
  previousOutputs: unknown[]
  humanFeedback?:  string
  maxTokens?:      number          // default: 8192
  temperature?:    number          // default: 0.2
  stream?:         boolean         // default: false
}

export interface AgentRunResult {
  output:       unknown            // JSON estruturado parseado
  rawText:      string             // texto bruto do modelo
  tokensInput:  number
  tokensOutput: number
  latencyMs:    number
  modelId:      string
  provider:     AgentProvider
  finishReason: string
}

export type AgentProvider =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'deepseek'
  | 'qwen'
  | 'moonshot'
  | 'minimax'
  | 'glm'
  | 'groq'
  | 'mistral'
  | 'openrouter'
  | 'ollama'
  | 'custom'

// Chunk emitido durante streaming
export interface StreamChunk {
  type:    'delta' | 'done' | 'error'
  delta?:  string
  result?: AgentRunResult
  error?:  string
}

// ─── Provider base URLs ───────────────────────────────────────────────────────

const PROVIDER_BASE_URLS: Record<AgentProvider, string> = {
  anthropic:  'https://api.anthropic.com/v1',
  openai:     'https://api.openai.com/v1',
  google:     'https://generativelanguage.googleapis.com/v1beta/openai',
  deepseek:   'https://api.deepseek.com/v1',
  qwen:       'https://dashscope.aliyuncs.com/compatible-mode/v1',
  moonshot:   'https://api.moonshot.cn/v1',
  minimax:    'https://api.minimax.chat/v1',
  glm:        'https://open.bigmodel.cn/api/paas/v4',
  groq:       'https://api.groq.com/openai/v1',
  mistral:    'https://api.mistral.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  ollama:     'http://localhost:11434/v1',
  custom:     '',
}

// ─── JSON extractor ───────────────────────────────────────────────────────────

function extractJSON(text: string): unknown {
  // 1. Remove blocos markdown
  const cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim()

  // 2. Tenta parse direto
  try {
    return JSON.parse(cleaned)
  } catch (_) {}

  // 3. Extrai o primeiro objeto/array JSON encontrado
  const objMatch = cleaned.match(/\{[\s\S]*\}/)
  const arrMatch = cleaned.match(/\[[\s\S]*\]/)

  if (objMatch) {
    try { return JSON.parse(objMatch[0]) } catch (_) {}
  }
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]) } catch (_) {}
  }

  // 4. Fallback: retorna o texto como objeto com chave 'content'
  return { content: text, _parseError: true }
}

// ─── Retry com backoff exponencial ───────────────────────────────────────────

async function withRetry<T>(
  fn:       () => Promise<T>,
  retries:  number = 3,
  baseDelay = 500,
): Promise<T> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))

      // Não retry em erros de autenticação/quota
      if (lastError.message.includes('401') || lastError.message.includes('403')) {
        throw lastError
      }

      if (attempt < retries) {
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 200
        console.warn(`[AgentRunner] Tentativa ${attempt + 1} falhou. Retry em ${Math.round(delay)}ms`)
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }

  throw lastError!
}

// ─── Anthropic native caller ──────────────────────────────────────────────────

async function callAnthropic(
  params: AgentRunParams,
  signal?: AbortSignal,
): Promise<{ text: string; inputTokens: number; outputTokens: number; finishReason: string }> {
  const res = await fetch(`${PROVIDER_BASE_URLS.anthropic}/messages`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         params.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      params.modelId,
      max_tokens: params.maxTokens ?? 8192,
      temperature: params.temperature ?? 0.2,
      system:     params.systemPrompt,
      messages:   [{ role: 'user', content: params.userPrompt }],
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Anthropic ${res.status}: ${body}`)
  }

  const data = await res.json()
  return {
    text:         data.content?.[0]?.text ?? '',
    inputTokens:  data.usage?.input_tokens  ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
    finishReason: data.stop_reason ?? 'end_turn',
  }
}

// ─── OpenAI-compatible caller ─────────────────────────────────────────────────

async function callOpenAICompat(
  params:  AgentRunParams,
  signal?: AbortSignal,
): Promise<{ text: string; inputTokens: number; outputTokens: number; finishReason: string }> {
  const baseUrl = params.baseUrl ?? PROVIDER_BASE_URLS[params.provider]

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${params.apiKey}`,
      // OpenRouter requer headers adicionais
      ...(params.provider === 'openrouter' ? {
        'HTTP-Referer': 'https://devfactory.app',
        'X-Title':      'DevFactory',
      } : {}),
    },
    body: JSON.stringify({
      model:       params.modelId,
      max_tokens:  params.maxTokens ?? 8192,
      temperature: params.temperature ?? 0.2,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user',   content: params.userPrompt   },
      ],
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${params.provider} ${res.status}: ${body}`)
  }

  const data = await res.json()
  const choice = data.choices?.[0]

  return {
    text:         choice?.message?.content ?? '',
    inputTokens:  data.usage?.prompt_tokens     ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    finishReason: choice?.finish_reason ?? 'stop',
  }
}

// ─── Streaming — Anthropic ────────────────────────────────────────────────────

async function* streamAnthropic(
  params: AgentRunParams,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const res = await fetch(`${PROVIDER_BASE_URLS.anthropic}/messages`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         params.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      params.modelId,
      max_tokens: params.maxTokens ?? 8192,
      stream:     true,
      system:     params.systemPrompt,
      messages:   [{ role: 'user', content: params.userPrompt }],
    }),
  })

  if (!res.ok) throw new Error(`Anthropic stream ${res.status}`)

  const reader  = res.body!.getReader()
  const decoder = new TextDecoder()
  let   buffer  = ''
  let   fullText = ''
  let   inputTokens = 0
  let   outputTokens = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (raw === '[DONE]') continue

      try {
        const event = JSON.parse(raw)

        if (event.type === 'content_block_delta') {
          const delta = event.delta?.text ?? ''
          fullText += delta
          yield { type: 'delta', delta }
        }

        if (event.type === 'message_delta') {
          outputTokens = event.usage?.output_tokens ?? outputTokens
        }

        if (event.type === 'message_start') {
          inputTokens = event.message?.usage?.input_tokens ?? 0
        }
      } catch (_) {}
    }
  }

  const output = extractJSON(fullText)
  yield {
    type: 'done',
    result: {
      output,
      rawText:      fullText,
      tokensInput:  inputTokens,
      tokensOutput: outputTokens,
      latencyMs:    0,
      modelId:      params.modelId,
      provider:     params.provider,
      finishReason: 'end_turn',
    },
  }
}

// ─── Streaming — OpenAI-compatible ───────────────────────────────────────────

async function* streamOpenAICompat(
  params: AgentRunParams,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const baseUrl = params.baseUrl ?? PROVIDER_BASE_URLS[params.provider]

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model:       params.modelId,
      max_tokens:  params.maxTokens ?? 8192,
      temperature: params.temperature ?? 0.2,
      stream:      true,
      messages: [
        { role: 'system', content: params.systemPrompt },
        { role: 'user',   content: params.userPrompt   },
      ],
    }),
  })

  if (!res.ok) throw new Error(`${params.provider} stream ${res.status}`)

  const reader   = res.body!.getReader()
  const decoder  = new TextDecoder()
  let   buffer   = ''
  let   fullText = ''
  let   inputTokens  = 0
  let   outputTokens = 0
  let   finishReason = 'stop'

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const raw = line.slice(6).trim()
      if (raw === '[DONE]') continue

      try {
        const event  = JSON.parse(raw)
        const delta  = event.choices?.[0]?.delta?.content ?? ''
        finishReason = event.choices?.[0]?.finish_reason ?? finishReason

        if (delta) {
          fullText += delta
          yield { type: 'delta', delta }
        }

        if (event.usage) {
          inputTokens  = event.usage.prompt_tokens     ?? 0
          outputTokens = event.usage.completion_tokens ?? 0
        }
      } catch (_) {}
    }
  }

  const output = extractJSON(fullText)
  yield {
    type: 'done',
    result: {
      output,
      rawText:      fullText,
      tokensInput:  inputTokens,
      tokensOutput: outputTokens,
      latencyMs:    0,
      modelId:      params.modelId,
      provider:     params.provider,
      finishReason,
    },
  }
}

// ─── Agent Runner ─────────────────────────────────────────────────────────────

export interface AgentRunnerOptions {
  retries?:    number    // default: 2
  timeoutMs?:  number    // default: 120_000 (2 min)
  emit?:       (event: SSEEvent) => void
}

export class AgentRunner {
  private retries:   number
  private timeoutMs: number
  private emit?:     (event: SSEEvent) => void

  constructor(opts: AgentRunnerOptions = {}) {
    this.retries   = opts.retries   ?? 2
    this.timeoutMs = opts.timeoutMs ?? 120_000
    this.emit      = opts.emit
  }

  // ── run() — chamada bloqueante, retorna output estruturado ─────────────────

  async run(params: AgentRunParams): Promise<AgentRunResult> {
    const controller = new AbortController()
    const timeout    = setTimeout(() => controller.abort(), this.timeoutMs)
    const startedAt  = Date.now()

    try {
      const result = await withRetry(async () => {
        const raw = await this.callModel(params, controller.signal)

        const output = extractJSON(raw.text)
        const latencyMs = Date.now() - startedAt

        this.emit?.({
          type:    'agent.completed',
          runId:   '',                 // preenchido pelo Orchestrator
          stage:   params.stage,
          payload: {
            modelId:      params.modelId,
            provider:     params.provider,
            tokensInput:  raw.inputTokens,
            tokensOutput: raw.outputTokens,
            latencyMs,
            hasParseError: (output as { _parseError?: boolean } | null)?._parseError === true,
          },
          timestamp: new Date(),
        })

        return {
          output,
          rawText:      raw.text,
          tokensInput:  raw.inputTokens,
          tokensOutput: raw.outputTokens,
          latencyMs,
          modelId:      params.modelId,
          provider:     params.provider,
          finishReason: raw.finishReason,
        } satisfies AgentRunResult
      }, this.retries)

      return result

    } finally {
      clearTimeout(timeout)
    }
  }

  // ── stream() — retorna AsyncIterator de chunks ────────────────────────────

  async *stream(params: AgentRunParams): AsyncGenerator<StreamChunk> {
    const controller = new AbortController()
    const timeout    = setTimeout(() => controller.abort(), this.timeoutMs)
    const startedAt  = Date.now()

    try {
      const generator = params.provider === 'anthropic'
        ? streamAnthropic(    { ...params, stream: true }, controller.signal)
        : streamOpenAICompat( { ...params, stream: true }, controller.signal)

      for await (const chunk of generator) {
        if (chunk.type === 'delta') {
          yield chunk
        }

        if (chunk.type === 'done' && chunk.result) {
          // Injeta latência real
          chunk.result.latencyMs = Date.now() - startedAt

          this.emit?.({
            type:    'agent.stream_done',
            runId:   '',
            stage:   params.stage,
            payload: {
              modelId:      chunk.result.modelId,
              tokensOutput: chunk.result.tokensOutput,
              latencyMs:    chunk.result.latencyMs,
            },
            timestamp: new Date(),
          })

          yield chunk
        }

        if (chunk.type === 'error') {
          yield chunk
          break
        }
      }

    } catch (err) {
      yield {
        type:  'error',
        error: err instanceof Error ? err.message : String(err),
      }
    } finally {
      clearTimeout(timeout)
    }
  }

  // ── callModel() — dispatcher de provider ─────────────────────────────────

  private async callModel(
    params: AgentRunParams,
    signal: AbortSignal,
  ): Promise<{ text: string; inputTokens: number; outputTokens: number; finishReason: string }> {
    if (params.provider === 'anthropic') {
      return callAnthropic(params, signal)
    }
    return callOpenAICompat(params, signal)
  }
}

// ─── Self-Critique Runner ─────────────────────────────────────────────────────
// Modelo barato avalia o output de outro modelo

export interface SelfCritiqueParams {
  stage:        PipelineStage
  operation:    string
  agentOutput:  unknown
  modelId:      string         // modelo barato (Haiku, Flash-Lite, GLM-4.7-Flash)
  provider:     AgentProvider
  apiKey:       string
  baseUrl?:     string
}

export interface SelfCritiqueResult {
  score:   number              // 0.0 – 1.0
  passed:  boolean
  issues:  Array<{
    severity: 'low' | 'medium' | 'high'
    message:  string
    location?: string
  }>
  summary: string
}

const SELF_CRITIQUE_SYSTEM = `Você é um revisor técnico do DevFactory.
Avalie o output de um agente de IA para a etapa especificada.

Retorne APENAS JSON com este schema exato:
{
  "score": <número 0.0-1.0>,
  "passed": <boolean, true se score >= 0.7>,
  "issues": [
    { "severity": "low|medium|high", "message": "<problema>", "location": "<onde>" }
  ],
  "summary": "<avaliação em 1-2 frases>"
}

Critérios de score:
1.0 = completo, correto, bem estruturado, sem problemas
0.7 = adequado, pequenos problemas que não bloqueiam
0.4 = incompleto ou com problemas moderados
0.0 = vazio, incoerente ou completamente errado`

const STAGE_CRITIQUE_CRITERIA: Record<PipelineStage, string> = {
  codebase_analysis: 'A análise cobre stack, convenções e cobertura de docs com oportunidades de melhoria acionáveis?',
  planning:        'O PRD tem goals, requirements, risks e estimativas claras?',
  docs_initial:    'A spec tem contratos de API, schema de DB e ADRs bem definidos?',
  design:          'Os design tokens são completos? Componentes têm props e variantes?',
  backend:         'O código é seguro, tem tratamento de erros e segue boas práticas?',
  frontend:        'Os componentes são acessíveis, responsivos e bem tipados?',
  tests:           'Os testes cobrem happy path, edge cases e cenários de erro?',
  quality_council: 'Os relatórios identificam issues reais com severidade correta?',
  docs_final:      'O README é claro? O changelog está atualizado?',
}

export async function runSelfCritique(
  params:  SelfCritiqueParams,
  runner:  AgentRunner,
): Promise<SelfCritiqueResult> {
  const criteria = STAGE_CRITIQUE_CRITERIA[params.stage]
  const outputStr = JSON.stringify(params.agentOutput, null, 2).slice(0, 3000)

  const result = await runner.run({
    stage:        params.stage,
    operation:    'self_critique',
    modelId:      params.modelId,
    provider:     params.provider,
    apiKey:       params.apiKey,
    baseUrl:      params.baseUrl,
    systemPrompt: SELF_CRITIQUE_SYSTEM,
    userPrompt: [
      `## Etapa avaliada: ${params.stage}`,
      `## Operação: ${params.operation}`,
      `## Critério principal: ${criteria}`,
      `## Output do agente:\n\`\`\`json\n${outputStr}\n\`\`\``,
      'Avalie e retorne o JSON de critique.',
    ].join('\n\n'),
    previousOutputs: [],
    maxTokens:    512,
    temperature:  0.1,
  })

  const raw = result.output as {
    score?:   number
    passed?:  boolean
    issues?:  SelfCritiqueResult['issues']
    summary?: string
  } | null

  return {
    score:   typeof raw?.score   === 'number'  ? raw.score   : 0.5,
    passed:  typeof raw?.passed  === 'boolean' ? raw.passed  : (raw?.score ?? 0) >= 0.7,
    issues:  Array.isArray(raw?.issues) ? raw.issues : [],
    summary: typeof raw?.summary === 'string'  ? raw.summary : 'Avaliação indisponível.',
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createAgentRunner(opts?: AgentRunnerOptions): AgentRunner {
  return new AgentRunner(opts)
}

// ─── Provider config helper ───────────────────────────────────────────────────
// Mapeia model_id do registry para provider + apiKey corretos

export interface ProviderKeyring {
  anthropic?:  string
  openai?:     string
  google?:     string
  deepseek?:   string
  qwen?:       string
  moonshot?:   string
  minimax?:    string
  glm?:        string
  groq?:       string
  mistral?:    string
  openrouter?: string
}

export function resolveProviderConfig(
  provider: AgentProvider,
  keyring:  ProviderKeyring,
): { apiKey: string; baseUrl?: string } {
  const key = keyring[provider as keyof ProviderKeyring]

  if (!key && provider !== 'ollama') {
    throw new Error(
      `[AgentRunner] API key ausente para provider "${provider}". ` +
      'Configure no keyring ou use OLLAMA para modelos locais.'
    )
  }

  return {
    apiKey:  key ?? 'ollama',
    baseUrl: provider === 'ollama' ? 'http://localhost:11434/v1' : undefined,
  }
}
