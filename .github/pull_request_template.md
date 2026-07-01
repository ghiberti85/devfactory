## O que esta PR faz

<!-- Descrição clara e concisa das mudanças. Inclua contexto suficiente para a revisão. -->

## Tipo de mudança

- [ ] Nova feature
- [ ] Bug fix
- [ ] Refactor (sem mudança de comportamento)
- [ ] Docs
- [ ] Chore (deps, configs, etc.)

## Issue relacionada

Closes #<!-- número da issue -->

---

## Checklist

### Código
- [ ] TypeScript compila sem erros (`npx tsc --noEmit`)
- [ ] ESLint passa sem warnings (`npx eslint . --max-warnings 0`)
- [ ] Todos os testes passam (`npx vitest run`)

### Segurança
- [ ] Rotas novas chamam `getSessionUser()` como primeiro passo
- [ ] Nenhum secret hard-coded nos diffs
- [ ] Tabelas novas têm RLS habilitado
- [ ] Código gerado pela IA só executa via `sandbox-runner.ts`

### Qualidade
- [ ] Componentes novos/modificados passam no axe-core
- [ ] Sem overflow horizontal em mobile (375px)
- [ ] Touch targets ≥ 44px

### Documentação
- [ ] `CONTEXT.md` atualizado se houver mudança arquitetural
- [ ] ADR novo em `docs/architecture.md` se houver decisão relevante
- [ ] `.env.example` atualizado se houver variável nova
- [ ] Migration em `db/migrations/` se houver mudança de schema

### Para novas etapas da pipeline
- [ ] `types.ts` — tipo adicionado
- [ ] `pipeline-workflow.ts` — operation, tier, prompt
- [ ] `model-selector.ts` — STAGE_PROFILES
- [ ] UI — STAGE_META em Dashboard, HumanGate, NewProjectForm

### Para novos providers de modelo
- [ ] `model-selector.ts` — tipo Provider
- [ ] `agent-runner.ts` — PROVIDER_BASE_URLS
- [ ] `ApiKeysSettings.jsx` — PROVIDERS array
- [ ] `.env.example` — PLATFORM_*_FREE_TIER_KEY (se free tier)
