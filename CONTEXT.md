# DevFactory — Especificação Completa do Projeto

> Documento de referência para iniciar o desenvolvimento. Consolida arquitetura, decisões técnicas, modelo de dados, fluxos de produto e roadmap de implementação definidos no design do projeto.

**Versão:** 0.2.0 · **Status:** Pré-desenvolvimento · **Autor:** Fernando Ghiberti

> **Changelog 0.2.0**: Orquestrador migrado de XState v5 + Map em memória para **Vercel Workflow SDK**; sandboxing migrado para **Vercel Sandbox** (substitui a avaliação anterior de `vm2`/Docker). Ver seções 11, 12.1 e 20.

---

## 1. Visão Geral

DevFactory é uma fábrica de software autônoma orquestrada por IA: um pipeline de 8 etapas (planejamento → documentação → design → backend → frontend → testes → quality council → documentação final) onde cada operação é executada por um agente de IA, com o modelo escolhido dinamicamente por complexidade e custo, e validação humana obrigatória entre etapas.

### Proposta de valor

- **Custo otimizado por arbitragem de modelo**: operações simples usam modelos gratuitos ou baratos (DeepSeek Flash, Gemini Flash-Lite, GLM-4.7-Flash); decisões críticas (segurança, arquitetura) usam modelos frontier (Claude Opus, GPT-5.5). Redução de custo observada em simulação: ~87% vs. usar um único modelo premium em tudo.
- **Aprendizado contínuo**: o sistema registra aprovação/rejeição humana por modelo e etapa, e ajusta suas escolhas futuras com base em histórico real — não só heurística estática.
- **Dois modos de operação**: *greenfield* (projeto novo, a partir de um briefing) e *brownfield* (repositório GitHub existente — o sistema lê, analisa e sugere melhorias respeitando o que já existe).
- **BYOK (Bring Your Own Key)**: cada usuário usa sua própria assinatura paga de LLM; modelos gratuitos ficam sempre disponíveis por padrão. Garante isolamento de custo em uso multi-tenant.
- **Human-in-the-loop**: nenhuma etapa avança sem aprovação explícita; feedback humano é injetado como contexto na iteração seguinte.

### Para quem é

Uso pessoal/freelance (acelerar entregas da LTDA) e potencial produto SaaS verticalizável (ex: "DevFactory para landing pages", "para APIs de e-commerce").

---

## 2. Glossário rápido

| Termo | Definição |
|---|---|
| **Run** | Uma execução completa da pipeline para um projeto |
| **Stage** | Uma das etapas da pipeline (planning, backend, etc.) |
| **Iteration** | Uma tentativa de execução dentro de uma etapa (pode haver várias por rejeição humana) |
| **Tier** | Nível de complexidade (1=simples/barato, 2=padrão, 3=crítico/frontier) atribuído pelo Complexity Router |
| **Gate** | Ponto de decisão humana obrigatória ao final de cada etapa |
| **BYOK** | Bring Your Own Key — usuário traz sua própria API key para desbloquear modelos pagos |
| **Greenfield** | Modo projeto novo, dirigido por briefing |
| **Brownfield** | Modo repositório existente, dirigido por análise de código real |
| **Repo Context** | Resumo estruturado de um repositório (stack, convenções, docs) gerado pelo GitHub Connector |
| **Self-critique** | Avaliação automática do output de um agente por um modelo barato, antes do gate humano |
| **Progressive Escalation** | Mecanismo que sobe o tier do modelo automaticamente se a auto-crítica falhar |

---

## 3. Arquitetura do Sistema

```
┌──────────────────────────────────────────────────────────────────┐
│                         FRONTEND (Next.js)                       │
│  AuthGate → Dashboard ⇄ NewProjectForm ⇄ ApiKeysSettings          │
│                              ⇣                                    │
│                         HumanGate (SSE/polling)                  │
└──────────────────────────────┬───────────────────────────────────┘
                                │ REST + SSE
┌──────────────────────────────▼───────────────────────────────────┐
│                    API ROUTES (Next.js App Router)                │
│  /api/runs (start workflow) · /api/runs/[id] (lê Postgres)       │
│  /api/runs/[id]/gate (resumeHook) · /api/runs/[id]/stream         │
│  /api/settings/api-keys · /api/github/*                          │
└──────────────────────────────┬───────────────────────────────────┘
                                │ start(runDevFactoryPipeline)
┌──────────────────────────────▼───────────────────────────────────┐
│           VERCEL WORKFLOWS — runDevFactoryPipeline()              │
│  Função durável: sobrevive a deploy/crash, pausa de min. a meses  │
│  Loop por etapa: "use step" (router→selector→agent→critique)     │
│  → humanGateHook (suspende) → resume via API → próxima etapa     │
└───────┬──────────────┬──────────────┬──────────────┬─────────────┘
        │              │              │              │
┌───────▼──────┐ ┌─────▼──────┐ ┌─────▼──────┐ ┌─────▼──────────┐
│ COMPLEXITY   │ │   MODEL    │ │   AGENT    │ │     GITHUB     │
│   ROUTER     │ │  SELECTOR  │ │   RUNNER   │ │   CONNECTOR    │
│ Tier 1/2/3   │ │ BYOK-aware │ │ Multi-prov │ │ RepoContext    │
└──────────────┘ └────────────┘ └────────────┘ └─────────────────┘
                                │
                  ┌─────────────▼─────────────┐
                  │   VERCEL SANDBOX           │
                  │   Tests + Quality Council  │
                  │   (microVMs isoladas)      │
                  └─────────────┬─────────────┘
                                │
┌──────────────────────────────▼───────────────────────────────────┐
│                    SUPABASE (Postgres + RLS + Auth)               │
│  Fonte de verdade do progresso AO VIVO (não getRun() do Workflow) │
│  models · projects · pipeline_runs · stage_outputs · model_calls │
│  human_gates · model_performance_history · user_api_keys          │
│  user_github_connections                                         │
└────────────────────────────────────────────────────────────────────┘
```

### Princípio arquitetural central

Toda chamada de modelo passa por dois filtros antes de executar: **Complexity Router** (que tier é necessário) e **Model Selector** (qual modelo concreto, considerando tier + força + custo + histórico + BYOK). Nenhum agente chama um modelo diretamente — sempre via esse pipeline de decisão.

A partir da v0.2, durabilidade/retry/observabilidade da orquestração são responsabilidade do **Vercel Workflow SDK**, não de código nosso — o `pipeline-workflow.ts` define *o que* acontece em cada etapa; o *como sobreviver a falhas* é da plataforma.

---

## 4. Stack Tecnológico

| Camada | Tecnologia | Justificativa |
|---|---|---|
| Frontend | Next.js 15 (App Router) + React 19 | SSR, Route Handlers nativos, ecossistema maduro |
| Orquestração | **Vercel Workflow SDK** | Durabilidade, retry e observabilidade nativos — pausa de minutos a meses sem custo de compute enquanto espera o gate humano. Substituiu XState v5 + Map em memória (não sobrevivia a restart/múltiplas instâncias). |
| Execução isolada | **Vercel Sandbox** | microVMs Firecracker para rodar testes/lint/análise de código gerado pela IA — nunca no processo da aplicação. Substituiu a ideia de `vm2` (descontinuado por CVEs de sandbox escape). |
| Backend runtime | Node.js + TypeScript | I/O-bound (chamadas a LLMs) — event loop não-bloqueante é ideal |
| Persistência | Supabase (Postgres + Auth + RLS) | Já usado no resto do stack pessoal; RLS resolve isolamento multi-tenant nativamente; fonte de verdade do progresso ao vivo dos runs |
| Real-time | SSE via polling-bridge sobre Postgres | Simples e verificável com a API que confirmei; migrar para streams duráveis nativos do Workflow SDK quando a assinatura exata for validada |
| Gráficos | Recharts | Já usado no Dashboard |
| Multi-model | Chamadas diretas por provider (Anthropic nativo + OpenAI-compatible para o resto) | Controle fino sobre streaming e parsing; sem dependência de gateway externo |

---

## 5. Estrutura de Pastas

```
devfactory/
├── lib/devfactory/                 # Backend puro — zero JSX
│   ├── types.ts                    # Tipos de domínio (PipelineStage, ProjectRun...) — sem dependência de motor
│   ├── pipeline-workflow.ts        # Orquestrador — Vercel Workflow SDK ("use workflow"/"use step")
│   ├── sandbox-runner.ts           # Execução isolada de testes/análise — Vercel Sandbox
│   ├── model-selector.ts           # Scoring + seleção de modelo (BYOK-aware)
│   ├── complexity-router.ts        # Classificação de tier via LLM barato
│   ├── agent-runner.ts             # Chamadas reais multi-provider
│   ├── github-connector.ts         # Leitura de repo existente (brownfield)
│   ├── run-registry.ts             # Resolução de credenciais (BYOK keyring + token GitHub)
│   └── auth.ts                     # Resolução de sessão
│
├── components/                     # UI reutilizável
│   ├── Dashboard.jsx
│   ├── NewProjectForm.jsx
│   ├── ApiKeysSettings.jsx
│   ├── AuthGate.jsx
│   └── HumanGate.tsx
│
├── app/                            # Next.js App Router
│   ├── layout.tsx · page.tsx
│   ├── login/page.tsx
│   ├── dashboard/page.tsx
│   ├── projects/new/page.tsx
│   ├── settings/api-keys/page.tsx
│   ├── runs/[runId]/page.tsx
│   └── api/
│       ├── runs/route.ts                        (POST)
│       ├── runs/[runId]/route.ts                 (GET, DELETE)
│       ├── runs/[runId]/gate/route.ts            (POST)
│       ├── runs/[runId]/stream/route.ts          (GET — SSE)
│       ├── settings/api-keys/route.ts            (GET, POST, DELETE)
│       └── github/
│           ├── repos/route.ts                    (GET)
│           ├── connect/route.ts                  (GET, DELETE)
│           └── connect/callback/route.ts         (GET)
│
├── db/schema.sql                   # Schema Postgres completo com RLS
├── middleware.ts                   # Auth gate de rotas
├── .env.example
└── package.json
```

---

## 6. Modelo de Dados (Supabase)

Schema completo em `db/schema.sql`. Toda tabela tem RLS habilitado; políticas seguem o padrão `auth.uid() = user_id` (direto ou via join até a tabela com `user_id`).

| Tabela | Propósito | RLS |
|---|---|---|
| `models` | Catálogo de modelos (default + custom) | Leitura pública (autenticado); escrita só via `service_role` |
| `user_api_keys` | BYOK — keys de LLM por usuário, criptografadas | Usuário só vê/edita as próprias |
| `user_github_connections` | Token OAuth do GitHub por usuário | Usuário só vê/edita a própria |
| `projects` | Metadados do projeto, briefing, modo (greenfield/brownfield) | Usuário só vê/edita os próprios |
| `pipeline_runs` | Execuções da pipeline | Usuário só vê/edita os próprios |
| `stage_outputs` | Output final aprovado de cada etapa | Via join até `pipeline_runs.user_id` |
| `stage_iterations` | Cada tentativa dentro de uma etapa | Via join |
| `model_calls` | Granular — toda chamada de modelo (tokens, custo, latência) | Via join |
| `human_gates` | Decisões humanas (aprovado/rejeitado/editado) | Via join |
| `model_performance_history` | Score agregado por usuário+modelo+etapa — alimenta o Selector | Usuário só vê o próprio histórico |
| `quality_reports` | Resultados do Quality Council por dimensão | Via join |
| `stage_model_overrides` | Override manual de modelo por etapa (modo `manual`/`auto_override`) | Via join até `projects.user_id` |

Views de observabilidade: `run_cost_breakdown` (custo por run/etapa/modelo) e `model_selector_scores` (score de performance por usuário/etapa, usado para debug do Selector).

---

## 7. Pipeline de Desenvolvimento — Etapas

### Greenfield (projeto novo)

```
planning → docs_initial → design → backend → frontend → tests → quality_council → docs_final
```

### Brownfield (repositório conectado)

```
codebase_analysis → planning → docs_initial → design → backend → frontend → tests → quality_council → docs_final
```

| Etapa | Tier default | Output principal | Critério de auto-crítica |
|---|---|---|---|
| `codebase_analysis` | 2 (escalável) | stack detectada, convenções, lacunas de docs, `improvement_opportunities[]` | Identificou problemas reais, não genéricos? |
| `planning` | 3 (fixo) | PRD: summary, goals, requirements, risks, milestones | Requisitos claros e acionáveis? |
| `docs_initial` | 2 | Specs técnicas, contratos de API, ADRs | Specs implementáveis sem ambiguidade? |
| `design` | 2 | Design tokens, wireframes JSX, guia de componentes | Consistência visual e acessibilidade básica? |
| `backend` | 2–3 (por operação) | Código de API, regras de negócio, schema | Segurança, tratamento de erro, padrões? |
| `frontend` | 2 (por operação) | Componentes, páginas, integração | Acessibilidade (ARIA), responsividade? |
| `tests` | 1–2 | Unit, integration, E2E | Cobre happy path + edge cases + erros? |
| `quality_council` | paralelo (1–3 por dimensão) | 5 relatórios: segurança, performance, SEO, a11y, boas práticas | Issues identificados são reais e acionáveis? |
| `docs_final` | 1 | README, changelog, ADRs atualizados | Documentação reflete o que foi construído? |

**Quality Council — tier por dimensão:** segurança sempre Tier 3; performance e a11y Tier 2; SEO e boas práticas Tier 1 (frequentemente gratuito).

**Operações que forçam Tier 3 independente do contexto** (`CRITICAL_OPERATIONS`): `auth`, `security_review`, `architecture_decision`, `prd_generation`, `risk_mapping`, `db_schema`.

---

## 8. Complexity Router

Meta-agente (sempre modelo gratuito/barato — Gemini Flash-Lite ou GLM-4.7-Flash) que avalia cada operação em 3 dimensões antes de qualquer execução:

```
score_final = (ambiguidade × 0.35) + (criticidade × 0.45) + (novidade × 0.20)

score_final < 0.30  → Tier 1
score_final < 0.60  → Tier 2
score_final ≥ 0.60  → Tier 3

EXCEÇÃO: criticidade ≥ 0.85 → Tier 3 sempre, ignora o score_final
```

- **Ambiguidade**: spec vaga vs. bem definida.
- **Criticidade**: impacto de um erro (boilerplate vs. falha de segurança/dados).
- **Novidade**: existe padrão no codebase (ou no Repo Context) ou é decisão nova?

Implementação: `lib/devfactory/complexity-router.ts`. Tem cache em memória por operação (evita rechamar o LLM para operações idênticas), retry com backoff, e fallback heurístico (keyword matching) se o LLM falhar — o pipeline nunca trava por indisponibilidade do classificador.

---

## 9. Model Selector

Escolhe o modelo concreto dentro do tier determinado pelo Router. Fórmula de score:

```
Score(modelo) = 0.30 × tier_fit
              + 0.25 × strength_fit
              + 0.25 × performance_histórico
              + 0.15 × custo_normalizado
              + 0.05 × latência_fit
```

- **tier_fit**: penaliza modelos com tier muito acima do necessário (custo desnecessário).
- **strength_fit**: overlap entre `strengths` do modelo (coding, reasoning, security, etc.) e o que a etapa/dimensão exige.
- **performance_histórico**: vem de `model_performance_history` — 60% aprovação humana + 30% auto-crítica média + 10% eficiência de custo. Prior neutro (0.5) se não há histórico.
- **custo_normalizado**: inversamente proporcional ao custo; modelos gratuitos/locais sempre pontuam máximo aqui.

### BYOK enforcement (regra de segurança crítica)

```typescript
const isPlatformFree = model.hasFreeTier || model.isLocal
const userHasOwnKey  = ctx.userProviders?.includes(model.provider) ?? false
if (!isPlatformFree && !userHasOwnKey) return false // modelo pago bloqueado
```

Um modelo pago só entra na lista de candidatos se o usuário atual tiver configurado sua própria key para aquele provider (`ApiKeysSettings`). Modelos gratuitos/locais usam a key de plataforma e ficam sempre disponíveis — custo zero, sem risco de um usuário consumir a assinatura de outro.

### Progressive Escalation

Se a auto-crítica retornar score < 0.70 (threshold configurável), o sistema re-seleciona automaticamente um tier acima antes de chegar ao gate humano — reduz rejeições sem custo médio elevado.

Implementação: `lib/devfactory/model-selector.ts`.

---

## 10. Model Registry (defaults)

| Tier | Exemplos | Faixa de custo (input/output por 1M tokens) |
|---|---|---|
| 1 — gratuito/barato | Gemini Flash-Lite, GLM-4.7-Flash, DeepSeek V4 Flash, Gemma 4 26B (local) | $0 – $0.30 |
| 2 — padrão | DeepSeek V4 Pro, Claude Sonnet 4.6, Qwen 3.6 Plus, Kimi K2.6 | $0.30 – $3 |
| 3 — frontier | Claude Opus 4.8, GPT-5.5, DeepSeek V4 Pro Max, GLM-5.1 | $2 – $30 |

Registry completo (18 modelos default) em `DEFAULT_MODELS` dentro de `model-selector.ts`, com origem classificada (`western` / `chinese` / `open-source`) para permitir filtros de compliance (`excludeOrigins`). Usuário pode adicionar modelos customizados (qualquer endpoint OpenAI-compatible, incluindo Ollama local) via UI futura de Model Registry (não implementada na v0.1 — hoje só via `customModels` no payload da API).

---

## 11. Orchestrator (Vercel Workflow SDK)

> **Mudança de arquitetura (v0.2.0)**: a v0.1 usava XState v5 + um `Map` em memória para o estado dos runs — funcionava, mas não sobrevivia a restart/deploy e não funcionava entre múltiplas instâncias serverless. A partir da v0.2, o orquestrador roda sobre o **Vercel Workflow SDK** (GA desde abril/2026), que resolve durabilidade, retry e observabilidade nativamente. Ver decisão registrada na seção 20.

```
POST /api/runs ──start()──► runDevFactoryPipeline() [workflow durável]
                                   │
                         para cada PipelineStage:
                                   │
                    ┌──────────────▼───────────────┐
                    │     runStageWithGate()        │  ("use workflow" — sem "use step",
                    │                                │   precisa criar hooks)
                    │  loop (max iterations):        │
                    │    runSingleStageStep()  ──────┼──► "use step": router → selector
                    │      ou (quality_council)       │    → agent → self-critique
                    │    runQualityCouncilStep() ─────┼──► "use step": 5x Vercel Sandbox
                    │                                 │    em paralelo (Promise.all)
                    │    score < threshold? escalate  │
                    │    tier e retry                 │
                    │                                 │
                    │  humanGateHook.create({token}) │
                    │  await hook  ◄══════════════════┼══ SUSPENDE AQUI. Zero custo de
                    │     (minutos a meses)            │   compute. Sobrevive a deploy.
                    └──────────────┬───────────────┘
                                   │
                    POST /api/runs/[id]/gate
                    → humanGateHook.resume(token, decision)
                                   │
                    aprovado → próxima etapa
                    rejeitado + retries → runStageWithGate() de novo (feedback injetado)
                    rejeitado + sem retries → FatalError
```

Pontos-chave da implementação:

- **Hooks só existem em nível de workflow**, não dentro de `"use step"` — por isso `runStageWithGate()` não tem a diretiva `"use step"`, mas as chamadas de IO (router, selector, agente, sandbox) ficam em funções `"use step"` separadas, que ganham retry automático e aparecem no dashboard de observabilidade do Vercel sem código extra.
- **Segurança de segredos**: o Workflow SDK persiste automaticamente input/output de cada step num event log durável. Por isso, a `ProjectRun` que entra no workflow carrega só `userProviders: string[]` (metadado — quais providers o usuário tem key própria), nunca a key decifrada. Cada step que efetivamente chama um modelo resolve a key na hora via `getUserKeyring(run.userId)`.
- **Fonte de verdade para a UI**: `getRun()` do Workflow SDK provavelmente só expõe o retorno final da função (quando ela termina) — não o estado intermediário enquanto suspensa em `await hook`. Por isso, o progresso "ao vivo" (etapa atual, token do gate, outputs parciais) é escrito no Postgres a cada transição (`persistAwaitingHumanStep`, `persistGateDecisionStep`) e é essa fonte que a UI consulta — `getRun()` entra só como cross-check de status terminal.
- **Quality Council** roda as 5 dimensões em paralelo dentro de um único `"use step"`, cada uma executando análise estática (Semgrep, ESLint, axe-core, Lighthouse CI) dentro de uma **Vercel Sandbox** isolada — nunca no processo da aplicação.

Implementação: `lib/devfactory/pipeline-workflow.ts` (orquestração) + `lib/devfactory/sandbox-runner.ts` (execução isolada) + `lib/devfactory/types.ts` (tipos de domínio, agora desacoplados de qualquer motor específico).

⚠️ **Itens a verificar contra a documentação atual antes de rodar em produção** (sinalizados como comentários no código): assinatura exata de `start()` e seu shape de retorno; existência de uma função programática de cancelamento de workflow (hoje só confirmei cancelamento via CLI); API exata de escrita de arquivos do `@vercel/sandbox` (`writeFiles` é um placeholder plausível, não confirmado). Nenhum desses pontos compromete a arquitetura — são detalhes de assinatura que mudam rápido num produto lançado há poucos meses.

---

## 12. Agent Runner

Executa a chamada real ao modelo escolhido — **inalterado pela migração para Workflows**, continua sendo chamado de dentro de um `"use step"` em `pipeline-workflow.ts`. Dois modos:

- **`run()`**: bloqueante, extrai JSON do texto retornado (com fallback se o modelo desobedecer o formato). O retry próprio (backoff exponencial, 3 tentativas) hoje convive com o retry automático que o Workflow SDK já dá a cada step — redundante, mas inofensivo; simplificável numa limpeza futura.
- **`stream()`**: `AsyncGenerator` de chunks — usado quando streaming de tokens é desejável na UI.

Suporta Anthropic nativo (endpoint `/v1/messages`) e qualquer provider OpenAI-compatible (DeepSeek, Qwen, GLM, Groq, Mistral, OpenRouter, Ollama) via um único adapter.

Implementação: `lib/devfactory/agent-runner.ts`.

---

## 12.1 Sandbox Runner (Vercel Sandbox)

Executa código gerado/testes em microVMs Firecracker isoladas — nunca no processo da aplicação, e explicitamente **não usa `vm2`** (projeto com CVEs sérios de sandbox escape, descontinuado como opção segura).

Padrão de segurança aplicado: instala dependências com rede liberada, depois chama `sandbox.setNetworkPolicy({ policy: 'deny-all' })` **antes** de rodar o código gerado pela IA — princípio do menor privilégio, já que testes/lint não precisam de acesso externo para rodar.

- `runTestsInSandbox()`: usado na etapa `tests`.
- `runQualityCheckInSandbox()`: usado no `quality_council`, uma chamada por dimensão (Semgrep para segurança, Lighthouse CI para performance/SEO, axe-core para a11y, ESLint para boas práticas).

Implementação: `lib/devfactory/sandbox-runner.ts`.

---

## 13. GitHub Connector (modo brownfield)

```typescript
fetchRepoContext(ref, userGithubToken) → RepoContext {
  readme, claudeMd, contextMd, docsFiles[],
  detectedStack: { language, frameworks, packageManager, testFramework, cssApproach, database },

  fileTree[], keyFiles[], conventions: { folderStructure, hasLinting, hasTests, hasCI },
}
```

Busca via GitHub API (token do usuário, BYOK-style): árvore de arquivos (limitada a 400 paths), README, `CLAUDE.md`/`CONTEXT.md` se existirem, até 15 arquivos de `docs/`, `package.json`/`tsconfig.json`. Detecta stack via parsing de dependências — nunca por inferência do LLM, para evitar alucinação.

`repoContextToPromptSummary()` serializa tudo para um texto único, injetado em **todas** as etapas da pipeline (não só `codebase_analysis`) via `run.repoContextSummary`.

Implementação: `lib/devfactory/github-connector.ts`.

---

## 14. Autenticação e Segurança Multi-tenant

- **Auth**: Supabase Auth — magic link (sem senha) ou OAuth (GitHub/Google).
- **Middleware**: `middleware.ts` redireciona não-autenticados para `/login` em qualquer rota.
- **RLS**: toda tabela com dado de usuário tem policy `auth.uid() = user_id` (direto ou via join). Nenhum dado cruza entre contas no nível do banco — não depende só da lógica de aplicação.
- **API routes**: cada handler chama `getSessionUser(req)` e, quando aplicável, valida `entry.ownerId === user.id` antes de liberar qualquer operação sobre um run.
- **BYOK**: chave de modelo pago e token GitHub são por usuário, criptografados em repouso (Supabase Vault/pgsodium), nunca expostos em texto puro além de uma máscara no frontend.
- **Separação de escopo**: keys de LLM (`user_api_keys`) e token GitHub (`user_github_connections`) ficam em tabelas separadas — escopos de permissão diferentes, ciclo de vida diferente.

---

## 15. API Routes

| Rota | Método | Função |
|---|---|---|
| `/api/runs` | POST | Inicia um run (greenfield ou brownfield) |
| `/api/runs/[runId]` | GET | Snapshot do estado atual |
| `/api/runs/[runId]` | DELETE | Cancela o run |
| `/api/runs/[runId]/gate` | POST | Submete decisão humana (approved/rejected/edited) |
| `/api/runs/[runId]/stream` | GET | Conexão SSE — eventos em tempo real |
| `/api/settings/api-keys` | GET/POST/DELETE | CRUD de BYOK keys de LLM |
| `/api/github/repos` | GET | Lista repositórios do usuário conectado |
| `/api/github/connect` | GET/DELETE | Inicia OAuth / desconecta GitHub |
| `/api/github/connect/callback` | GET | Callback OAuth — troca code por token |

---

## 16. Componentes de Frontend e Fluxo de Navegação

```
/login ──(autenticação)──► /dashboard ──(➕ Novo Projeto)──► /projects/new
                                ▲                                    │
                                │                          (submete briefing/repo)
                                │                                    ▼
                                └────────── /runs/[runId] ◄── POST /api/runs
                                         (HumanGate, SSE)

/dashboard ──(🔑 API Keys)──► /settings/api-keys (BYOK + conexão GitHub)
```

| Componente | Responsabilidade |
|---|---|
| `AuthGate.jsx` | Login (magic link / OAuth) |
| `Dashboard.jsx` | Observabilidade: custos, leaderboard de modelos, learning loop. Tabs: Overview / Models / Learning. Botão "Novo Projeto" (inline no desktop, FAB no mobile) |
| `NewProjectForm.jsx` | Toggle Novo Projeto / Repositório Existente; 8 templates de briefing (landing, API, dashboard, blog, e-commerce, SaaS, ferramenta interna, backend mobile); picker de repo GitHub; configuração avançada (selector mode, free tier, max iterations, budget) |
| `ApiKeysSettings.jsx` | BYOK de modelos LLM + conexão/desconexão GitHub |
| `HumanGate.tsx` | Acompanha um run em tempo real via SSE; aprova/edita/rejeita cada etapa; painel especial para Quality Council |

---

## 17. Variáveis de Ambiente

### Separação importante: keys de plataforma vs BYOK

| Tipo | Quem configura | Onde fica | Paga quem |
|---|---|---|---|
| **Keys de plataforma** (`PLATFORM_*`) | Dono da plataforma (você) | Vercel env vars | Você — mas são free tier, custo ~$0 |
| **Keys BYOK** (Anthropic, OpenAI, etc.) | Cada usuário | Supabase `user_api_keys` criptografado | Cada usuário paga a própria conta |

**Não existe** `PLATFORM_ANTHROPIC_KEY` nem `PLATFORM_OPENAI_KEY` — intencional. Modelos pagos só ficam disponíveis quando o usuário configura a própria key em `/settings/api-keys`. Você nunca paga pelos modelos pagos de outros usuários.

### Obrigatórias (Vercel + local)

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=           # painel Supabase → Settings → API
NEXT_PUBLIC_SUPABASE_ANON_KEY=      # painel Supabase → Settings → API
SUPABASE_SERVICE_ROLE_KEY=          # painel Supabase → Settings → API

# URL do app
NEXT_PUBLIC_APP_URL=https://devfactory.vercel.app

# Router — OBRIGATÓRIO, roda em todo request como infraestrutura interna
PLATFORM_GOOGLE_FREE_TIER_KEY=      # aistudio.google.com/apikey — gratuito
ROUTER_PROVIDER=google
ROUTER_MODEL=gemini-2.5-flash-lite

# Criptografia BYOK dos usuários
BYOK_ENCRYPTION_KEY=                # gerar: openssl rand -base64 32
```

### Opcionais — ampliam o Tier 1 gratuito disponível para todos os usuários

```bash
PLATFORM_DEEPSEEK_FREE_TIER_KEY=    # platform.deepseek.com/api_keys
PLATFORM_GLM_FREE_TIER_KEY=         # open.bigmodel.cn/usercenter/apikeys
PLATFORM_QWEN_FREE_TIER_KEY=        # dashscope.console.aliyun.com/apiKey
PLATFORM_GROQ_FREE_TIER_KEY=        # console.groq.com/keys
```

### Modo brownfield — opcional, configurar quando for usar

```bash
GITHUB_OAUTH_CLIENT_ID=             # github.com/settings/developers → New OAuth App
GITHUB_OAUTH_CLIENT_SECRET=
# Callback: https://devfactory.vercel.app/api/github/connect/callback
```

---

## 18. Roadmap de Implementação

### Fase 0 — Fundação (1–2 dias)
- [ ] Criar projeto Supabase, rodar `db/schema.sql`
- [ ] Configurar Supabase Auth (magic link + OAuth GitHub/Google)
- [ ] Popular tabela `models` com o seed de `DEFAULT_MODELS`
- [ ] Implementar `lib/devfactory/auth.ts` com `@supabase/ssr` real (substituir placeholder)
- [ ] `vercel link` + `vercel env pull` no projeto para habilitar Workflow SDK e Sandbox localmente (autenticação via OIDC)
- [ ] **Critério de aceite**: login funcional redirecionando para `/dashboard`

### Fase 0.5 — Validar APIs do Workflow SDK e Sandbox (0.5–1 dia)
Fase nova, específica da migração para Vercel Workflows — resolve os pontos marcados com ⚠️ no código antes de depender deles:
- [ ] Confirmar a assinatura exata de `start()` (`workflow/api`) e o shape do valor retornado — usado em `app/api/runs/route.ts`
- [ ] Confirmar se existe cancelamento programático de workflow (hoje só achei via CLI) — afeta `DELETE /api/runs/[runId]`
- [ ] Confirmar o método de escrita de arquivos do `@vercel/sandbox` (`writeFiles` em `sandbox-runner.ts` é um placeholder plausível)
- [ ] Rodar o exemplo oficial de "durable AI code agent" (`vercel.com/kb/guide/how-to-build-a-durable-ai-code-agent-on-vercel`) localmente para validar o padrão Workflow + Sandbox + retry antes de adaptar para o DevFactory
- [ ] Decidir se vale migrar `app/api/runs/[runId]/stream/route.ts` do polling-bridge atual para os streams duráveis nativos (`getWritable()`) depois de validar a API
- [ ] **Critério de aceite**: um workflow de "hello world" (`'use workflow'` com 2 steps e um hook) rodando localmente com `vercel dev`, pausando e resumindo via uma chamada manual a `resumeHook`

### Fase 1 — Pipeline greenfield mínima (3–5 dias)
- [ ] Implementar a leitura de `pipeline_runs`/`stage_outputs` no Postgres nos 3 lugares marcados como placeholder (`app/api/runs/[runId]/route.ts`, `.../stream/route.ts`, `.../gate/route.ts`)
- [ ] Implementar `getUserKeyring()` real em `run-registry.ts` (query `user_api_keys` + decriptação)
- [ ] Validar `ComplexityRouter` + `ModelSelector` com chamadas reais a pelo menos 3 providers (ex: Google, DeepSeek, Anthropic)
- [ ] Testar o loop completo: `planning` → `humanGateHook` suspende → `POST .../gate` resume → `docs_initial`
- [ ] **Critério de aceite**: um run greenfield completo, ponta a ponta, com pelo menos 2 etapas reais (não mockadas), 1 gate humano funcional, e o workflow sobrevivendo a um `vercel dev` reiniciado no meio da espera do gate

### Fase 2 — Pipeline completa + Quality Council (3–4 dias)
- [ ] Implementar as 8 etapas com prompts reais testados
- [ ] Integrar ferramentas reais no Quality Council: ESLint, axe-core, Lighthouse CLI, Semgrep
- [ ] **Critério de aceite**: run completo das 8 etapas até `docs_final`, com Quality Council rodando as 5 dimensões em paralelo

### Fase 3 — BYOK completo (2 dias)
- [ ] Implementar criptografia real (Supabase Vault ou camada de aplicação)
- [ ] Validação de key (`onTest` em `ApiKeysSettings`) com chamada real a cada provider
- [ ] Testar enforcement: usuário sem key paga só vê Tier 1 disponível
- [ ] **Critério de aceite**: dois usuários de teste, um com key paga e outro sem, recebendo seleções de modelo diferentes para a mesma operação

### Fase 4 — Modo brownfield (3–4 dias)
- [ ] Registrar GitHub App/OAuth App real
- [ ] Implementar fluxo de conexão completo (`/api/github/connect/*`)
- [ ] Testar `fetchRepoContext` em repositórios reais de tamanhos variados
- [ ] **Critério de aceite**: conectar um repositório real (ex: `ghiberti85/interview-command-center`), rodar `codebase_analysis`, e validar que o output reflete a stack real do projeto

### Fase 5 — Dashboard com dados reais (2 dias)
- [ ] Substituir mock data do `Dashboard.jsx` pelas views `run_cost_breakdown`/`model_selector_scores`
- [ ] **Critério de aceite**: dashboard refletindo runs reais executados nas fases anteriores

### Fase 6 — Polish e produção (3+ dias)
- [ ] Rate limiting nas API routes
- [ ] Observabilidade (logs estruturados, alertas de erro)
- [ ] Testes E2E do fluxo crítico (login → novo projeto → aprovação → conclusão)
- [ ] Deploy (Vercel + Supabase produção)

---

## 19. Convenções do Projeto

- TypeScript estrito em `lib/devfactory/**`; componentes podem ser `.jsx` ou `.tsx` (mistura aceitável no Next.js).
- Toda mutação de estado do `ProjectRun` passa por função pura em `orchestrator.ts` — nunca mutar diretamente.
- Toda chamada de modelo passa por `ComplexityRouter` → `ModelSelector` — nunca instanciar um provider diretamente num componente ou rota.
- Toda rota de API autenticada chama `getSessionUser()` antes de qualquer lógica.
- Cores/tokens de design centralizados no objeto `T` por componente (replicar o padrão já usado no Dashboard/NewProjectForm/ApiKeysSettings) até existir um design system compartilhado real.

---

## 20. Decisões em aberto (para revisitar durante o desenvolvimento)

### ✅ Resolvidas (v0.2.0)

- ~~Persistência do `runRegistry`~~ → Migrado para **Vercel Workflow SDK**. O workflow em si é durável nativamente; o progresso ao vivo para a UI é persistido em Postgres pelos steps `persistAwaitingHumanStep`/`persistGateDecisionStep`. Ver seção 11 e `lib/devfactory/pipeline-workflow.ts`.
- ~~Sandboxing de código gerado~~ → Migrado para **Vercel Sandbox** (`@vercel/sandbox`), com `setNetworkPolicy('deny-all')` aplicado antes de rodar código gerado pela IA. `vm2` foi descartado explicitamente (CVEs de sandbox escape conhecidos). Ver seção 12.1 e `lib/devfactory/sandbox-runner.ts`.

Essas duas decisões geraram itens de verificação (não bloqueiam o início do desenvolvimento, mas precisam ser confirmados cedo — ver Fase 0.5 do roadmap): assinatura de `start()`, cancelamento programático de workflow, e a API exata de escrita de arquivos do Sandbox. Nenhum deles muda a arquitetura escolhida, só a sintaxe exata de chamada.

### Em aberto

- **Limite de tamanho de repositório no GitHub Connector** (hoje trunca em 400 arquivos): avaliar migrar de fetch eager para exploração agêntica (`list_directory`/`read_file` como tools, via `ToolLoopAgent` do AI SDK 7) se algum repositório real ultrapassar o limite. Não é urgente para os projetos pessoais atuais (DevInterviewLab, ICC, Philosophia, etc. — nenhum chega perto de 400 arquivos).
- **Model Registry UI**: permitir que o usuário adicione modelos customizados via interface (hoje só via payload de API).
- **Streams duráveis nativos do Workflow SDK**: o polling-bridge atual em `.../stream/route.ts` funciona mas não é tão eficiente quanto os streams nativos (`getWritable()`) — migrar quando a API estiver validada (Fase 0.5).
- **Versões pinadas no `package.json`**: `workflow`, `@workflow/ai` e `@vercel/sandbox` estão como `"latest"` — trocar por versões fixas assim que o setup inicial rodar, para evitar quebras silenciosas em deploys futuros.
