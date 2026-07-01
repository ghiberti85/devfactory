# Arquitetura — DevFactory

> Decisões arquiteturais com histórico e raciocínio. Novos ADRs devem ser adicionados ao final, nunca editar ADRs já registrados (somente marcar como superseded).

---

## Visão geral do sistema

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND  Next.js 15 App Router + React 19                  │
│  AuthGate → Dashboard ⇄ NewProjectForm ⇄ ApiKeysSettings     │
│                        HumanGate (SSE polling)               │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST + SSE
┌──────────────────────────▼──────────────────────────────────┐
│  API ROUTES  Next.js Route Handlers                          │
│  /api/runs (start) · /api/runs/[id]/gate (resume hook)      │
│  /api/runs/[id]/stream (SSE) · /api/github/* · /api/keys/*  │
└──────────────────────────┬──────────────────────────────────┘
                           │ start() / humanGateHook.resume()
┌──────────────────────────▼──────────────────────────────────┐
│  VERCEL WORKFLOW SDK   runDevFactoryPipeline()               │
│  Função durável — sobrevive a deploys, crashes, semanas      │
│  "use step": router → selector → agent → critique           │
│  humanGateHook: suspende até aprovação humana               │
└──────┬───────────┬──────────────┬──────────────┬────────────┘
       │           │              │              │
  Complexity   Model         Agent          Vercel
  Router       Selector      Runner         Sandbox
  (tier)       (BYOK)        (multi-prov)   (isolado)
       │           │              │              │
┌──────▼───────────▼──────────────▼──────────────▼────────────┐
│  SUPABASE   Postgres + Auth + RLS                            │
│  Fonte de verdade do progresso ao vivo                       │
│  pipeline_runs · stage_outputs · model_calls · user_api_keys │
└─────────────────────────────────────────────────────────────┘
```

---

## ADR-001: Vercel Workflow SDK como orquestrador

**Status**: Aceito (v0.2.0)
**Supersede**: ADR-001-DRAFT que propunha XState v5 + Map em memória

**Contexto**: A pipeline do DevFactory precisa orquestrar 8-9 etapas sequenciais, cada uma com um loop de tentativas e uma pausa indefinida esperando aprovação humana (minutos a semanas). Um orquestrador em memória (XState + Map) não sobrevive a restart, crash ou deploy, e não funciona em múltiplas instâncias serverless.

**Decisão**: Usar o Vercel Workflow SDK (GA desde abril/2026). A função `runDevFactoryPipeline()` é marcada com `'use workflow'` — torna-se uma função durável com replay determinístico. Gates humanos usam `defineHook()` / `createHook()` com `await hook` para suspender a execução sem custo de compute.

**Consequências**:
- ✅ Durabilidade, retry e observabilidade nativos — zero código de infraestrutura
- ✅ O gate humano pode esperar semanas sem manter nenhum processo rodando
- ✅ Dashboard de runs no Vercel sem nenhum código extra
- ⚠️ Lock-in no Vercel — migrar para outro host seria reescrever o orquestrador
- ⚠️ Três pontos de API não confirmados com documentação primária (ver CLAUDE.md) — resolver na Fase 0.5

**Alternativas rejeitadas**:
- XState v5 + Supabase Realtime: requer manter estado sincronizado manualmente entre instâncias
- Inngest/Trigger.dev: equivalentes funcionais, mas a integração nativa com Vercel Sandbox e o tooling de deployment já consolidado no Vercel favoreceram manter o ecossistema único

---

## ADR-002: Vercel Sandbox para execução de código gerado

**Status**: Aceito (v0.2.0)

**Contexto**: A etapa de `tests` e o `quality_council` precisam executar código gerado pela IA (testes Jest/Vitest, ESLint, Semgrep, axe-core). Executar no processo da aplicação seria um risco de segurança severo.

**Decisão**: Usar `@vercel/sandbox` para criar microVMs Firecracker isoladas. Padrão de segurança: instalar dependências com rede liberada, depois `setNetworkPolicy('deny-all')` antes de rodar o código gerado pela IA.

**Consequências**:
- ✅ Isolamento real (Firecracker microVM, não só containers)
- ✅ Integração nativa com o Workflow SDK (Sandbox é serializável entre steps)
- ✅ Rota sudo disponível para instalar qualquer ferramenta de análise
- ⚠️ Custo adicional por uso de Sandbox (billing separado do Workflow)

**Alternativas rejeitadas**:
- `vm2`: descontinuado pelos mantenedores por CVEs de sandbox escape — proibido neste projeto
- Docker no host: complexidade operacional, sem integração nativa com Vercel

---

## ADR-003: BYOK (Bring Your Own Key) como modelo de acesso a modelos pagos

**Status**: Aceito (v0.1.0)

**Contexto**: O DevFactory pode ser usado por múltiplas pessoas. Se a plataforma usasse as próprias chaves de API para modelos pagos (Claude Opus, GPT-5.5), qualquer usuário consumiria a assinatura do dono da plataforma.

**Decisão**: Modelos pagos só ficam disponíveis para um usuário se ele configurar sua própria API key em `/settings/api-keys`. Keys são criptografadas em repouso (Supabase Vault), descriptografadas dentro de cada step do workflow no momento da chamada, e nunca persistidas no event log do Workflow SDK. Modelos com `hasFreeTier || isLocal` ficam sempre disponíveis usando chaves de plataforma (custo zero ou negligível).

**Consequências**:
- ✅ Isolamento de custo perfeito — cada usuário paga pelo que usa
- ✅ Usuário sem keys ainda tem acesso a Tier 1 completo (DeepSeek Flash, Gemini Flash-Lite, GLM-4.7-Flash, Gemma 4 local)
- ⚠️ Fricção de onboarding — usuário precisa configurar keys antes de usar modelos premium

---

## ADR-004: Supabase como fonte de verdade do progresso ao vivo

**Status**: Aceito (v0.2.0)

**Contexto**: `getRun()` do Workflow SDK provavelmente só expõe o retorno final de uma função workflow (quando ela termina), não variáveis locais enquanto suspensa em `await hook`. Para mostrar o progresso ao vivo na UI (etapa atual, token do gate, outputs parciais), precisamos de uma fonte que reflita o estado intermediário.

**Decisão**: Steps de persistência (`persistAwaitingHumanStep`, `persistGateDecisionStep`) escrevem no Postgres a cada transição relevante. A rota `GET /api/runs/[id]/stream` faz polling dessa tabela a cada 2s e emite SSE. `getRun()` do Workflow SDK entra só como cross-check de status terminal.

**Consequências**:
- ✅ Funciona com a API do Workflow SDK que foi confirmada com certeza
- ⚠️ Polling a cada 2s — não é push nativo. Migrar para stream nativo quando a API for validada (Fase 0.5)
- ⚠️ Duplicação leve: o Workflow SDK já persiste tudo internamente, mas em formato opaco (não acessível via nossa RLS)

---

## ADR-005: Postgres como RLS enforcement para multi-tenancy

**Status**: Aceito (v0.1.0)

**Contexto**: Múltiplos usuários compartilham as mesmas tabelas. Precisamos garantir que um usuário não acesse dados de outro mesmo se houver um bug na lógica de aplicação.

**Decisão**: Row Level Security habilitado em **toda** tabela com dados de usuário. Política padrão: `auth.uid() = user_id` (direto ou via join até `pipeline_runs.user_id`). O client Supabase nas rotas de API usa a sessão do usuário autenticado (não o `service_role` key), então as políticas de RLS se aplicam automaticamente a toda query.

**Consequências**:
- ✅ Segurança em duas camadas: lógica de aplicação + banco de dados
- ✅ Um bug no código não expõe dados de outros usuários
- ⚠️ Queries com joins precisam de atenção — a política RLS deve cobrir todas as tabelas na cadeia do join

---

## ADR-006: Complexity Router sempre em modelo gratuito

**Status**: Aceito (v0.1.0)

**Contexto**: O Complexity Router avalia cada operação antes de executá-la. Se o próprio classificador usasse um modelo caro, o custo de operar o sistema explodiria.

**Decisão**: O Router sempre usa modelos com `hasFreeTier: true` (Gemini Flash-Lite ou GLM-4.7-Flash). Usa a key de plataforma (não BYOK), pois é infraestrutura interna — não executa código do usuário. Tem cache em memória por operação para evitar rechamar o LLM para operações idênticas.

---

## ADR-007: Tokens de gate como `devfactory:{runId}:{stage}:{iteration}`

**Status**: Aceito (v0.2.0)

**Contexto**: O hook do gate humano precisa de um token único por ponto de pausa para que o sistema saiba qual workflow retomar quando o usuário aprova. O token também precisa carregar o `runId` para que a rota de gate possa verificar o ownership antes de resolver o hook.

**Decisão**: Formato: `devfactory:{runId}:{stage}:{iteration}`. Determinístico, extraível sem banco de dados, hierárquico. A verificação de ownership extrai o `runId` do token e confirma contra `pipeline_runs.user_id` antes de chamar `humanGateHook.resume()`.

---

## ADR-008: Modo greenfield vs brownfield como parâmetro do run

**Status**: Aceito (v0.1.0)

**Contexto**: Dois fluxos distintos: projeto novo (briefing em branco) e repositório existente (análise de código real antes do planejamento).

**Decisão**: `ProjectRun.config.projectMode: 'greenfield' | 'brownfield'` determina qual lista de etapas usar (`getPipelineStages(mode)`). O `RepoContext` é gerado **antes** de `start()` na API route (não dentro do workflow) para manter o token do GitHub fora do event log. A etapa `codebase_analysis` só existe na lista brownfield.

---

## Modelo de dados — relacionamentos principais

```
auth.users (Supabase)
    │
    ├── user_api_keys (provider, encrypted_key)        ← BYOK de LLMs
    ├── user_github_connections (encrypted_token)      ← OAuth GitHub
    │
    └── projects (user_id)
            │
            └── pipeline_runs (project_id, user_id)
                    │
                    ├── stage_outputs (run_id)
                    │       ├── stage_iterations (output_id)
                    │       │       └── model_calls (iteration_id)
                    │       └── human_gates (output_id)
                    ├── quality_reports (run_id via stage_outputs)
                    └── model_performance_history (user_id, model_id)
```

---

## Fluxo de dados — chamada de modelo (exemplo: etapa backend)

```
runSingleStageStep("use step")
  │
  ├── ComplexityRouter.route({ stage: 'backend', operation, spec })
  │     → Gemini Flash-Lite analisa dimensões (ambiguidade/criticidade/novidade)
  │     → retorna { tier: 2, confidence: 0.85, ... }
  │
  ├── ModelSelector.select({ stage, tier: 2, userProviders: ['deepseek'] })
  │     → filtra: plataforma gratuita OU provider em userProviders
  │     → pontua: tier_fit × 0.30 + strength_fit × 0.25 + performance × 0.25 + custo × 0.15 + latência × 0.05
  │     → retorna { model: DeepSeek V4 Pro, score: 0.87, ... }
  │
  ├── getUserKeyring(run.userId)  ← AQUI, não no input do workflow
  │     → query Supabase user_api_keys → decripta via Vault
  │     → retorna { deepseek: 'sk-...' }
  │
  ├── AgentRunner.run({ modelId, provider: 'deepseek', apiKey: 'sk-...', ... })
  │     → POST api.deepseek.com/v1/chat/completions
  │     → extrai JSON da resposta
  │
  └── Auto-crítica (Gemini Flash-Lite, key de plataforma)
        → { score: 0.82, passed: true, issues: [] }
```
