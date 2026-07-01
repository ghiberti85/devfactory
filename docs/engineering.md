# Padrões de Engenharia — DevFactory

> Convenções, padrões e boas práticas aplicadas ao projeto. Toda contribuição deve seguir estas diretrizes. Atualizado para 2026.

---

## TypeScript

### Configuração

`tsconfig.json` deve ter:
```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

### Tipos
```typescript
// ✅ Tipos explícitos em funções públicas
export async function runStageWithGate(
  run: ProjectRun,
  stage: PipelineStage,
): Promise<ProjectRun> { ... }

// ✅ Discriminated unions em vez de any/unknown
type StageStatus =
  | { kind: 'running'; iterationNumber: number }
  | { kind: 'awaiting_human'; gateToken: string }
  | { kind: 'approved'; finalOutput: unknown }
  | { kind: 'failed'; reason: string }

// ✅ Zod para validação de dados externos (API inputs, LLM outputs)
const GateDecisionSchema = z.object({
  token:        z.string().min(1),
  decision:     z.enum(['approved', 'rejected', 'edited']),
  feedback:     z.string().optional(),
  editedOutput: z.unknown().optional(),
})
type GateDecision = z.infer<typeof GateDecisionSchema>

// ❌ Nunca — inferência perigosa
const data: any = await response.json()
const decision = data.decision  // sem tipo

// ❌ Nunca — asserção de tipo sem validação
const run = state as ProjectRun  // poderia ser qualquer coisa
```

### Error handling
```typescript
// ✅ FatalError para erros que o workflow não deve retentar
import { FatalError, RetryableError } from 'workflow'

try {
  const selection = selector.select(ctx)
} catch (err) {
  // Sem modelo disponível (BYOK não configurado) → retry nunca resolveria
  throw new FatalError(err instanceof Error ? err.message : 'Sem modelo disponível.')
}

// ✅ RetryableError para falhas transitórias (rate limit, timeout de rede)
if (response.status === 429) {
  throw new RetryableError('Rate limit atingido — o Workflow SDK vai retentar com backoff.')
}

// ✅ Nunca swallow silenciosamente
} catch (err) {
  console.error('[AgentRunner] Falha na chamada:', err)
  throw err  // sempre repropagar ou tratar explicitamente
}
```

---

## React e componentes

### Estrutura de componente
```typescript
// ✅ Arquivo completo com separação clara de responsabilidades
// 1. Imports
import { useState, useEffect, useCallback } from 'react'
import type { ProjectRun } from '@/lib/devfactory/types'

// 2. Types locais
interface Props {
  runId: string
  onComplete?: (run: ProjectRun) => void
}

// 3. Hook customizado (se o componente for complexo)
function useRunStream(runId: string) { ... }

// 4. Sub-componentes puros (sem estado próprio)
function StageOutputPanel({ stage, stageData, onApprove, onReject }: StageOutputPanelProps) { ... }

// 5. Componente principal — export default
export default function HumanGate({ runId, onComplete }: Props) {
  const { run, status, sendDecision } = useRunStream(runId)
  // ...
}
```

### Performance de componentes
```typescript
// ✅ useCallback para callbacks passados como props
const sendDecision = useCallback(
  async (decision: 'approved' | 'rejected', feedback?: string) => {
    await fetch(...)
  },
  [runId, pendingStage]  // deps mínimas e corretas
)

// ✅ useMemo para computações derivadas pesadas
const filteredRepos = useMemo(
  () => repos.filter(r => r.fullName.toLowerCase().includes(search.toLowerCase())),
  [repos, search]
)

// ✅ Lazy loading para componentes pesados (Dashboard com charts)
const Dashboard = lazy(() => import('@/components/Dashboard'))

// ❌ Evitar — re-renders desnecessários
const handler = () => doSomething()  // nova referência a cada render
<Child onClick={handler} />
```

### State management
```typescript
// ✅ Estado local para UI (não compartilhado entre rotas)
const [activeTab, setActiveTab] = useState<'overview' | 'models' | 'learning'>('overview')

// ✅ URL state para estado navegável (tab ativa, filtros)
// usar nuqs ou searchParams do Next.js 15
const [tab, setTab] = useQueryState('tab', { defaultValue: 'overview' })

// ✅ Server components para dados que não precisam de interatividade
// app/dashboard/page.tsx — busca dados no servidor, passa como props
export default async function DashboardPage() {
  const runs = await getRuns() // server-side
  return <Dashboard runs={runs} />
}
```

---

## API Routes

### Estrutura padrão de um route handler
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSessionUser, unauthorizedResponse } from '@/lib/devfactory/auth'

// Schema de validação ANTES da função handler
const RequestSchema = z.object({
  projectName: z.string().min(3).max(100),
  briefing:    z.string().min(20).optional(),
})

export async function POST(req: NextRequest) {
  // 1. Auth — sempre primeiro
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  // 2. Parse e validação
  const raw = await req.json().catch(() => null)
  const parsed = RequestSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Dados inválidos.', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  // 3. Lógica de negócio
  try {
    const result = await doSomething(parsed.data, user)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    // 4. Error handling tipado
    if (err instanceof UserFacingError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    console.error('[API /runs POST]', err)
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 })
  }
}
```

### Rate limiting
```typescript
// Toda rota pública deve ter rate limiting
// lib/devfactory/rate-limit.ts
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

export const rateLimiter = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '10 s'),
})

// Uso em route handlers
const { success, remaining } = await rateLimiter.limit(user.id)
if (!success) {
  return NextResponse.json(
    { error: 'Rate limit atingido. Tente novamente em alguns segundos.' },
    { status: 429, headers: { 'Retry-After': '10' } }
  )
}
```

---

## Banco de dados (Supabase)

### Regras de query
```typescript
// ✅ Sempre usar o client com sessão do usuário (não service_role) em route handlers
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const supabase = createServerClient(url, anonKey, { cookies: () => cookies() })
// RLS aplica automaticamente com o cookie de sessão

// ✅ Selecionar só os campos necessários
const { data } = await supabase
  .from('pipeline_runs')
  .select('id, status, current_stage, total_cost_usd')  // não select('*')
  .eq('id', runId)
  .single()

// ✅ Sempre verificar errors do Supabase
const { data, error } = await supabase.from('models').select('*')
if (error) throw new Error(`Supabase query failed: ${error.message}`)

// ❌ Nunca usar service_role em route handlers públicos
const supabase = createClient(url, SERVICE_ROLE_KEY)  // bypass de RLS
```

### Migrations
- Toda mudança de schema vai em `db/migrations/YYYYMMDD_descricao.sql`
- Nunca editar `db/schema.sql` diretamente após o setup inicial — usar migrations
- Toda migration deve ter um `-- DOWN:` comentado para rollback

---

## Git e pull requests

### Convenção de commits (Conventional Commits)
```
feat(workflow): add progressive escalation after self-critique failure
fix(selector): correct BYOK enforcement for openrouter provider
docs(architecture): add ADR-009 for polling-bridge decision
test(pipeline): add integration test for gate rejection + retry flow
refactor(types): extract StageRecord to separate interface
perf(dashboard): lazy load ModelLeaderboard component
chore(deps): pin workflow and @vercel/sandbox to exact versions
```

### Branch naming
```
feat/add-model-registry-ui
fix/gate-token-ownership-check
docs/update-engineering-standards
test/e2e-login-flow
```

### Checklist de PR
- [ ] TypeScript compila sem erros (`npx tsc --noEmit`)
- [ ] Lint passa (`npx eslint . --ext .ts,.tsx,.jsx`)
- [ ] Todos os testes passam (`npx vitest run`)
- [ ] Componentes novos/modificados passam no axe-core
- [ ] Documentação atualizada se a mudança afeta arquitetura ou padrões
- [ ] Variáveis de ambiente novas adicionadas ao `.env.example`
- [ ] Migrations novas adicionadas a `db/migrations/`

---

## Logging e observabilidade

### Padrão de log
```typescript
// ✅ Logs estruturados com contexto
console.log('[DevFactory]', {
  event:   'stage.model_selected',
  runId:   run.id,
  stage,
  model:   selection.model.displayName,
  tier:    routerOutput.tier,
  costEst: selection.estimatedCostUsd,
})

// ✅ Erro com stack
console.error('[AgentRunner] LLM call failed', {
  provider: params.provider,
  modelId:  params.modelId,
  error:    err instanceof Error ? err.message : err,
  stack:    err instanceof Error ? err.stack : undefined,
})

// ❌ Logs sem contexto
console.log('done')
console.error(err)

// ❌ Nunca logar dados sensíveis
console.log('user keyring:', keyring)  // exposição de API keys
```

### Métricas importantes a monitorar (produção)
- Custo por run por usuário (`model_calls.cost_usd` somado por `pipeline_runs.user_id`)
- Taxa de aprovação por etapa e modelo (`human_gates.decision` agrupado)
- Latência por step de workflow (Vercel Workflows dashboard nativo)
- Erros de sandbox (exit code ≠ 0 em `sandbox-runner.ts`)
- Hooks não resolvidos após 24h (workflows suspensos há muito tempo)

---

## Dependências

### Regras
- Fixar versões em produção (`"workflow": "1.2.3"`, não `"latest"`)
- Auditar dependências antes de adicionar: `npm audit` + verificar manutenção ativa
- Preferir dependências já no projeto a adicionar novas
- `@vercel/sandbox`, `workflow`, `@workflow/ai`, `zod`, `@supabase/*` são core — não remover
- `xstate` foi removido na v0.2.0 — não readicionar

### Atualizações
- Dependências de segurança: atualizar imediatamente
- Dependências de features: atualizar em PRs isoladas, com testes
- `workflow` e `@vercel/sandbox`: verificar changelog antes de atualizar (API ainda evoluindo)

---

## Internacionalização (i18n)

A v0.1 é PT-BR only. Para quando internacionalização for necessária:
- Usar `next-intl` (já familiar no stack pessoal do Fernando, usado em Theogonia/Philosophia Oriental)
- Chaves de tradução em `messages/{locale}.json`
- Componentes nunca devem ter strings hard-coded em português
- Datas: usar `Intl.DateTimeFormat` com locale explícito

---

## Convenções de design de sistema (2026)

### API design
- REST para operações CRUD e comandos (POST /api/runs, POST /api/runs/[id]/gate)
- SSE para streams de estado em tempo real (GET /api/runs/[id]/stream)
- Webhooks para integrações externas (GitHub OAuth callback)
- Resposta de erro consistente: `{ error: string, details?: unknown, code?: string }`

### Versionamento de API
- As rotas atuais não têm prefixo de versão — aceitável para uso pessoal/early stage
- Quando houver usuários externos: adicionar `/api/v1/` e manter `/api/v1/` por pelo menos 6 meses após deprecar

### Idempotência
- `POST /api/runs` não é idempotente por design (cria um novo run a cada chamada)
- `POST /api/runs/[id]/gate` deve ser idempotente — resolver o mesmo hook duas vezes não deve causar erro (o Workflow SDK já trata isso internamente)
