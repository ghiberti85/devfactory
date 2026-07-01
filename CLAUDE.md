# CLAUDE.md — DevFactory

> Arquivo lido automaticamente pelo Claude Code ao iniciar qualquer sessão neste repositório. Contém tudo que é necessário para contribuir corretamente sem contexto adicional.

## O que é este projeto

**DevFactory** é uma fábrica de software autônoma orquestrada por IA: uma pipeline de 9 etapas (codebase_analysis opcional → planning → docs_initial → design → backend → frontend → tests → quality_council → docs_final) onde cada operação é executada por um agente de IA, com o modelo escolhido dinamicamente por complexidade e custo, e validação humana obrigatória entre etapas.

Stack principal: **Next.js 15 + TypeScript + Vercel Workflow SDK + Vercel Sandbox + Supabase**.

Documentação completa: `CONTEXT.md` (arquitetura), `docs/` (padrões de engenharia).

---

## Estrutura do repositório

```
devfactory/
├── CLAUDE.md                       ← este arquivo
├── CONTEXT.md                      ← arquitetura completa do projeto
├── README.md                       ← setup e onboarding
├── docs/
│   ├── architecture.md             ← decisões arquiteturais (ADRs)
│   ├── engineering.md              ← padrões de código e boas práticas
│   ├── testing.md                  ← estratégia de testes
│   ├── security.md                 ← segurança e BYOK
│   └── quality.md                  ← performance, SEO, a11y, responsividade
├── lib/devfactory/                 ← backend puro (TypeScript estrito, zero JSX)
│   ├── types.ts                    ← tipos de domínio (fonte da verdade)
│   ├── pipeline-workflow.ts        ← orquestrador Vercel Workflow SDK
│   ├── sandbox-runner.ts           ← execução isolada Vercel Sandbox
│   ├── model-selector.ts           ← escolha de modelo (BYOK-aware)
│   ├── complexity-router.ts        ← classificação de tier (Tier 1/2/3)
│   ├── agent-runner.ts             ← chamadas multi-provider a LLMs
│   ├── github-connector.ts         ← leitura de repositório existente
│   ├── run-registry.ts             ← resolução de credenciais (BYOK)
│   └── auth.ts                     ← resolução de sessão Supabase
├── components/                     ← UI (React/JSX, client-side)
│   ├── Dashboard.jsx
│   ├── NewProjectForm.jsx
│   ├── ApiKeysSettings.jsx
│   ├── AuthGate.jsx
│   └── HumanGate.tsx
├── app/                            ← Next.js App Router
│   ├── api/runs/**                 ← pipeline API (start, gate, stream)
│   ├── api/github/**               ← OAuth GitHub + repo listing
│   └── api/settings/api-keys/**   ← BYOK keys management
├── db/schema.sql                   ← schema Postgres completo com RLS
└── middleware.ts                   ← proteção de rotas
```

---

## Regras absolutas (nunca violar)

### Segurança
1. **API keys nunca trafegam como dado de workflow** — o Workflow SDK persiste input/output de cada step num event log. `ProjectRun` carrega só `userProviders: string[]` (metadado), nunca a key decifrada. Keys são resolvidas dentro de cada step via `getUserKeyring(run.userId)`.
2. **Modelos pagos só ficam disponíveis com BYOK configurado** — a regra em `model-selector.ts` (`filterCandidates`) bloqueia todo modelo com `hasFreeTier === false && !isLocal` se o provider não estiver em `ctx.userProviders`. Não contornar essa checagem.
3. **Toda rota de API chama `getSessionUser()` primeiro** — antes de qualquer lógica. Retornar 401 imediatamente se não houver sessão.
4. **Código gerado pela IA só roda dentro do Vercel Sandbox** (`sandbox-runner.ts`), nunca no processo da aplicação. `sandbox.update({ networkPolicy: 'deny-all' })` **antes** de rodar o código.
5. **RLS em toda tabela do Supabase** — toda query que lida com dados de usuário usa o client com a sessão do usuário, não o `service_role` key. O `service_role` só é usado para operações de admin (seed de modelos, migrations).
6. **`vm2` é proibido** — tem CVEs de sandbox escape conhecidos e o projeto foi descontinuado. Não adicionar como dependência.

### Arquitetura
7. **Hooks só em nível de workflow** — funções marcadas com `"use step"` não podem criar hooks (`humanGateHook.create()`). O step suspenso iria reexecutar no replay e criaria hooks duplicados. `runStageWithGate()` em `pipeline-workflow.ts` deliberadamente não tem `"use step"` por isso.
8. **Toda mutação de `ProjectRun` é imutável** — os reducers (`initStage`, `appendIteration`, `approveStage`, `rejectStage`) sempre retornam um novo objeto, nunca mutam in-place. O Workflow SDK usa esses valores como snapshots serializáveis.
9. **Postgres é a fonte de verdade do progresso ao vivo** — não `getRun()` do Workflow SDK (que provavelmente só expõe o retorno final da função). Steps de persistência (`persistAwaitingHumanStep`, `persistGateDecisionStep`) escrevem no Postgres a cada transição para que o stream da UI reflita o estado real.
10. **TypeScript estrito em `lib/devfactory/**`** — sem `any` implícito, sem `as any` desnecessário. Componentes `.jsx`/`.tsx` podem ser menos rígidos, mas ainda sem `any` implícito.

### Qualidade
11. **Todo componente novo precisa de testes** — unit tests em Vitest para lógica pura, integration tests para steps do workflow, E2E com Playwright para flows críticos (login → criar run → aprovar etapa).
12. **Acessibilidade WCAG 2.2 AA** — todo componente novo precisa passar no axe-core antes de merge. Sem elementos interativos sem `aria-label`. Contraste mínimo 4.5:1 para texto.
13. **Performance budget** — Time to Interactive < 3.5s, Largest Contentful Paint < 2.5s. Qualquer componente que possa ultrapassar esses limites precisa de lazy loading explícito.

---

## Como o pipeline funciona (resumo executivo)

```
POST /api/runs
  → createProjectRun() — monta o objeto ProjectRun com userId, userProviders, repoContext (se brownfield)
  → start(runDevFactoryPipeline, [{ run }]) — dispara o Vercel Workflow

runDevFactoryPipeline() — "use workflow"
  → para cada estágio em getPipelineStages(run.config.projectMode):
      runStageWithGate(run, stage) — NÃO tem "use step"
        → loop (até maxIterationsPerStage):
            runSingleStageStep() — "use step" (ou runQualityCouncilStep para quality_council)
              → ComplexityRouter avalia a operação → retorna tier
              → ModelSelector escolhe o modelo (BYOK-aware, histórico de performance)
              → AgentRunner executa a chamada ao modelo (chave resolvida na hora)
              → Auto-crítica (modelo barato avalia o output)
            se score < threshold: aumenta tier, retry
        → humanGateHook.create({ token }) — cria o hook com token único
        → await hook — SUSPENDE. Zero custo. Sobrevive a deploys.
        → (humano clica aprovar/rejeitar via HumanGate)
        → POST /api/runs/[id]/gate → humanGateHook.resume(token, decision) — RESUME
        → se aprovado: próxima etapa
        → se rejeitado + retries: retry com feedback injetado no prompt
        → se rejeitado + sem retries: FatalError
```

---

## Padrões de código

### Nomenclatura
- **Arquivos**: `kebab-case.ts` para módulos, `PascalCase.tsx` para componentes
- **Funções**: `camelCase`, verbos descritivos (`createProjectRun`, `runStageWithGate`, `fetchRepoContext`)
- **Types/Interfaces**: `PascalCase` (`ProjectRun`, `StageRecord`, `HumanGateDecision`)
- **Constantes**: `UPPER_SNAKE_CASE` (`PIPELINE_STAGES_GREENFIELD`, `STAGE_OPERATIONS`)
- **Hooks React**: prefixo `use` (`useBreakpoint`, `useRunStream`)

### Imports
```typescript
// 1. Externos (Node/npm)
import { defineHook } from 'workflow'
import { z } from 'zod'

// 2. Next.js
import { NextRequest, NextResponse } from 'next/server'

// 3. Internos — lib/devfactory
import type { ProjectRun, PipelineStage } from '@/lib/devfactory/types'
import { createSelector } from '@/lib/devfactory/model-selector'

// 4. Componentes
import Dashboard from '@/components/Dashboard'
```

### TypeScript
```typescript
// ✅ Correto — tipo explícito
const tier: Tier = STAGE_DEFAULT_TIER[stage]

// ❌ Errado — any implícito
const tier = STAGE_DEFAULT_TIER[stage]  // pode inferir errado

// ✅ Correto — erro de tipo capturado como FatalError
} catch (err) {
  throw new FatalError(err instanceof Error ? err.message : 'Erro desconhecido.')
}

// ❌ Errado — swallowing silencioso
} catch {}
```

### "use step" vs "use workflow"
```typescript
// ✅ I/O externo (LLM, Sandbox, Postgres) → "use step"
async function runSingleStageStep(run: ProjectRun, stage: PipelineStage): Promise<StageStepResult> {
  'use step'
  // ... router, selector, agent, critique
}

// ✅ Hooks e lógica de fluxo → "use workflow" / sem diretiva
async function runStageWithGate(run: ProjectRun, stage: PipelineStage): Promise<ProjectRun> {
  // sem "use step" — cria hooks aqui
  using hook = humanGateHook.create({ token })
  const decision = await hook
}

// ❌ Errado — hook dentro de step
async function wrongExample() {
  'use step'
  using hook = humanGateHook.create({ token })  // NÃO FAZER
}
```

---

## Adicionando um novo provedor de modelo

1. Adicionar o provider ao tipo `Provider` em `model-selector.ts`
2. Adicionar a base URL em `PROVIDER_BASE_URLS` em `agent-runner.ts`
3. Adicionar a entrada em `PROVIDERS` em `ApiKeysSettings.jsx` (com `unlockedTier` correto)
4. Adicionar a key de plataforma (se free tier) em `.env.example`
5. Adicionar ao seed de `DEFAULT_MODELS` com todos os campos obrigatórios

---

## Adicionando uma nova etapa à pipeline

1. Adicionar o literal ao tipo `PipelineStage` em `types.ts`
2. Adicionar à lista `PIPELINE_STAGES_GREENFIELD` ou `PIPELINE_STAGES_BROWNFIELD` em `types.ts`
3. Adicionar a operação em `STAGE_OPERATIONS` em `pipeline-workflow.ts`
4. Adicionar o tier default em `STAGE_DEFAULT_TIER`
5. Adicionar o system prompt em `STAGE_SYSTEM_PROMPTS`
6. Adicionar o perfil em `STAGE_PROFILES` em `model-selector.ts`
7. Adicionar o critério de auto-crítica em `STAGE_CRITIQUE_CRITERIA` em `agent-runner.ts`
8. Adicionar metadado visual em `STAGE_META` nos componentes de UI (`Dashboard.jsx`, `HumanGate.tsx`, `NewProjectForm.jsx`)

---

## Verificações antes de qualquer commit

```bash
# 1. TypeScript
npx tsc --noEmit

# 2. Lint
npx eslint . --ext .ts,.tsx,.jsx

# 3. Testes
npx vitest run

# 4. Acessibilidade (componentes novos/modificados)
npx axe-cli http://localhost:3000/dashboard

# 5. Brace/paren balance (arquivos TS/TSX modificados)
node -e "
  const fs = require('fs');
  const f = 'lib/devfactory/pipeline-workflow.ts';
  const c = fs.readFileSync(f, 'utf8');
  const o = (c.match(/\{/g)||[]).length, x = (c.match(/\}/g)||[]).length;
  console.log(f, o === x ? 'OK' : 'MISMATCH', o, x);
"
```

---

## Variáveis de ambiente necessárias para desenvolvimento local

```bash
# Copiar o template e preencher
cp .env.example .env.local
```

### Obrigatórias para funcionar

```bash
# Supabase — do painel do seu projeto
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# URL do app (para OAuth callbacks)
NEXT_PUBLIC_APP_URL=http://localhost:3000  # local; https://devfactory.vercel.app em produção
```

### Keys de PLATAFORMA (suas — modelos gratuitos para todos os usuários)

```bash
# Google AI Studio — gratuito, 1.500 req/dia
# https://aistudio.google.com/apikey
PLATFORM_GOOGLE_FREE_TIER_KEY=   # ← mínimo necessário (Router usa isso)

# Opcionais no início, ampliam o Tier 1 disponível:
PLATFORM_DEEPSEEK_FREE_TIER_KEY=
PLATFORM_GLM_FREE_TIER_KEY=
PLATFORM_GROQ_FREE_TIER_KEY=
```

> **Por que essas keys são suas?** O Complexity Router roda em background para
> todos os usuários — é infraestrutura da plataforma, não execução de código
> do usuário. Os modelos Tier 1 (free tier) ficam disponíveis por padrão para
> qualquer pessoa que use o app, sem custo real para você ou para eles.

### Keys que NÃO vão para o Vercel

```
Claude Opus, GPT-5.5, DeepSeek Pro, Qwen Max, Kimi, MiniMax, Mistral...
```

Essas são **BYOK exclusivo** — cada usuário configura a própria em
`/settings/api-keys`. Você nunca paga por modelos pagos de outros usuários.
Não existe variável `PLATFORM_ANTHROPIC_KEY` ou `PLATFORM_OPENAI_KEY` — é intencional.

### Para Vercel Sandbox e Workflow (autenticação automática via OIDC)
```bash
vercel link      # autentica o projeto localmente
vercel env pull  # baixa as variáveis do Vercel para .env.local
```

---

## Pontos de atenção marcados no código (⚠️)

Buscar por `⚠️` no repositório para encontrar itens que precisam de verificação antes de ir para produção:

- Assinatura exata de `start()` em `workflow/api` — `app/api/runs/route.ts`
- Cancelamento programático de workflow — `app/api/runs/[runId]/route.ts`
- API exata de escrita de arquivos do `@vercel/sandbox` — `lib/devfactory/sandbox-runner.ts`
- Implementação real das queries Postgres (hoje placeholders comentados) — `app/api/runs/[runId]/route.ts` e `stream/route.ts`

Esses pontos foram marcados por honestidade — a API exata não foi confirmada com documentação primária no momento em que o código foi escrito. Validar na Fase 0.5 do roadmap antes de qualquer outro desenvolvimento.

---

## Contexto adicional

- Ver `CONTEXT.md` para arquitetura completa, modelo de dados, e roadmap
- Ver `docs/security.md` para o modelo de ameaças e práticas de segurança
- Ver `docs/testing.md` para estratégia de testes e exemplos
- Ver `docs/engineering.md` para padrões de código mais detalhados
- Ver `docs/quality.md` para performance, SEO, acessibilidade e responsividade
