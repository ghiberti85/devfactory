# DevFactory

**Fábrica de software autônoma orquestrada por IA.** Uma pipeline de 9 etapas onde cada operação é executada pelo melhor modelo disponível para aquele contexto, com validação humana obrigatória entre etapas, custo otimizado por arbitragem de modelo e execução de testes em ambientes isolados.

> Documentação completa: [`CLAUDE.md`](./CLAUDE.md) (Claude Code), [`CONTEXT.md`](./CONTEXT.md) (arquitetura), [`docs/`](./docs/) (padrões de engenharia)

---

## Stack

| | |
|---|---|
| **Frontend** | Next.js 15 (App Router) + React 19 + TypeScript |
| **Orquestração** | Vercel Workflow SDK — pipeline durável, gates humanos nativos |
| **Sandboxing** | Vercel Sandbox (Firecracker microVM) — testes e análise de qualidade |
| **Auth + DB** | Supabase Auth + Postgres com Row Level Security |
| **Modelos** | Multi-provider: Anthropic, OpenAI, Google, DeepSeek, Qwen, GLM, Kimi, MiniMax, Mistral, Groq, OpenRouter, Ollama |

---

## Setup de desenvolvimento

### Pré-requisitos

- Node.js 22+
- pnpm 9+ (ou npm 10+)
- Conta Vercel (para Workflows e Sandbox)
- Projeto Supabase

### 1. Clone e instale

```bash
git clone https://github.com/ghiberti85/devfactory.git
cd devfactory
pnpm install
```

### 2. Variáveis de ambiente

```bash
# Copiar o template
cp .env.example .env.local

# Preencher as variáveis mínimas para desenvolvimento:
# - NEXT_PUBLIC_SUPABASE_URL
# - NEXT_PUBLIC_SUPABASE_ANON_KEY
# - PLATFORM_GOOGLE_FREE_TIER_KEY  (Google AI Studio — gratuito)
# - PLATFORM_DEEPSEEK_FREE_TIER_KEY
# - PLATFORM_GLM_FREE_TIER_KEY

# Vercel Sandbox e Workflow usam autenticação OIDC — sem variável manual necessária:
vercel link       # vincula o projeto local ao Vercel
vercel env pull   # baixa as vars do Vercel para .env.local
```

### 3. Banco de dados

```bash
# Rodar o schema no seu projeto Supabase
# Opção A: via Supabase CLI
supabase db push --db-url postgresql://...

# Opção B: colar db/schema.sql no SQL Editor do painel Supabase

# Popular o registry de modelos (seed)
# Executar DEFAULT_MODELS de lib/devfactory/model-selector.ts via script:
pnpm db:seed
```

### 4. Iniciar o servidor

```bash
pnpm dev
# http://localhost:3000
```

---

## Fluxo de uso

```
1. Login → /login (magic link ou GitHub/Google)
2. Dashboard → /dashboard (overview de runs, custos, modelos)
3. Novo projeto → /projects/new
   a. Projeto novo: preencher briefing + escolher template
   b. Repo existente: conectar GitHub → selecionar repositório
4. Run inicia → /runs/[runId] (HumanGate em tempo real)
5. Revisar cada etapa: aprovar / editar / rejeitar com feedback
6. Pipeline conclui → output completo disponível no Dashboard
7. Configurar modelos pagos → /settings/api-keys (BYOK)
```

---

## Etapas da pipeline

| Modo | Etapas |
|---|---|
| **Greenfield** (projeto novo) | planning → docs → design → backend → frontend → tests → quality_council → docs_final |
| **Brownfield** (repo existente) | **codebase_analysis** → planning → docs → design → backend → frontend → tests → quality_council → docs_final |

O **Quality Council** roda 5 dimensões em paralelo dentro de Vercel Sandboxes isoladas: segurança (Semgrep), performance (Lighthouse CI), SEO (Lighthouse), acessibilidade (axe-core) e boas práticas (ESLint).

---

## BYOK — seus modelos, seu custo

Por padrão, o DevFactory usa apenas modelos gratuitos (Tier 1):

- Gemini Flash-Lite / GLM-4.7-Flash (sempre gratuitos)
- DeepSeek V4 Flash (free tier)
- Gemma 4 26B (Ollama local, custo zero)

Para usar modelos Tier 2/3 (Claude Opus, GPT-5.5, DeepSeek Pro Max):

1. Acesse `/settings/api-keys`
2. Clique "Conectar" ao lado do provider
3. Cole sua API key — ela é criptografada antes de salvar
4. O Selector passará a incluir esses modelos nas suas escolhas

---

## Documentação

| Arquivo | Conteúdo |
|---|---|
| [`CLAUDE.md`](./CLAUDE.md) | Instruções para Claude Code — regras, padrões, como adicionar etapas/providers |
| [`CONTEXT.md`](./CONTEXT.md) | Arquitetura completa, ADRs, modelo de dados, roadmap |
| [`docs/architecture.md`](./docs/architecture.md) | Decisões arquiteturais (ADRs) com histórico |
| [`docs/engineering.md`](./docs/engineering.md) | Padrões de código, TypeScript, git, API design |
| [`docs/testing.md`](./docs/testing.md) | Estratégia de testes, exemplos, CI pipeline |
| [`docs/security.md`](./docs/security.md) | Modelo de ameaças, BYOK, RLS, sandbox |
| [`docs/quality.md`](./docs/quality.md) | Performance, SEO, acessibilidade, responsividade |

---

## Scripts disponíveis

```bash
pnpm dev          # servidor de desenvolvimento
pnpm build        # build de produção
pnpm start        # produção local
pnpm lint         # ESLint
pnpm test         # Vitest (unit + integration)
pnpm test:e2e     # Playwright E2E
pnpm test:cover   # Vitest com cobertura
pnpm test:all     # todos os testes
pnpm db:seed      # popular o registry de modelos
```

---

## Estrutura rápida

```
lib/devfactory/   → backend: pipeline, modelos, GitHub, auth
components/       → UI React
app/              → Next.js App Router (pages + API routes)
db/               → schema SQL e migrations
docs/             → documentação técnica
```

---

## Licença

Projeto pessoal de Fernando Ghiberti (FERNANDO DE SOUZA GHIBERTI LTDA). Todos os direitos reservados.

