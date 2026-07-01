# Estratégia de Testes — DevFactory

> Cobertura mínima, padrões e exemplos para cada camada do sistema.

---

## Stack de testes

| Camada | Framework | Propósito |
|---|---|---|
| Unit | Vitest | Funções puras — reducers, Model Selector, parsers |
| Integration | Vitest + MSW | Steps do workflow com providers mockados |
| E2E | Playwright | Fluxos críticos de usuário ponta a ponta |
| Acessibilidade | axe-core (via Playwright) | WCAG 2.2 AA em todas as páginas |
| Performance | Lighthouse CI | Performance budget no CI |
| Segurança | Semgrep | SAST em cada PR |

---

## Estrutura de arquivos de teste

```
devfactory/
├── __tests__/
│   ├── unit/
│   │   ├── model-selector.test.ts
│   │   ├── complexity-router.test.ts
│   │   ├── pipeline-reducers.test.ts
│   │   └── github-connector.test.ts
│   ├── integration/
│   │   ├── pipeline-workflow.test.ts
│   │   ├── agent-runner.test.ts
│   │   └── api/
│   │       ├── runs.test.ts
│   │       └── gate.test.ts
│   └── e2e/
│       ├── auth.spec.ts
│       ├── new-project.spec.ts
│       ├── gate-approve.spec.ts
│       └── a11y.spec.ts
├── vitest.config.ts
└── playwright.config.ts
```

---

## Testes unitários

### Model Selector — exemplo completo
```typescript
// __tests__/unit/model-selector.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { ModelSelector, DEFAULT_MODELS, createSelector } from '@/lib/devfactory/model-selector'

describe('ModelSelector', () => {
  let selector: ModelSelector

  beforeEach(() => {
    selector = createSelector()
  })

  describe('filterCandidates — BYOK enforcement', () => {
    it('exclui modelos pagos quando userProviders está vazio', () => {
      const result = selector.select({
        stage: 'backend',
        operation: 'crud-endpoint',
        tier: 2,
        userProviders: [],  // nenhuma key configurada
      })
      // Deve retornar apenas modelos gratuitos
      expect(result.model.hasFreeTier || result.model.isLocal).toBe(true)
    })

    it('inclui modelos pagos quando userProviders contém o provider', () => {
      const result = selector.select({
        stage: 'backend',
        operation: 'crud-endpoint',
        tier: 2,
        userProviders: ['deepseek'],  // usuário tem key DeepSeek
      })
      // Agora pode selecionar DeepSeek V4 Pro (pago, Tier 2)
      const isPaid = !result.model.hasFreeTier && !result.model.isLocal
      if (isPaid) {
        expect(result.model.provider).toBe('deepseek')
      }
    })

    it('lança erro descritivo quando nenhum candidato está disponível', () => {
      expect(() =>
        selector.select({
          stage: 'planning',
          operation: 'prd-generation',
          tier: 3,
          userProviders: [],  // Tier 3 todo pago, sem keys
          preferFreeTier: true,
        })
      ).toThrow(/Nenhum modelo disponível/)
    })
  })

  describe('CRITICAL_OPERATIONS — força Tier 3', () => {
    it('força Tier 3 para operação auth independente do tier informado', () => {
      const result = selector.select({
        stage: 'backend',
        operation: 'auth',  // operation crítica
        tier: 1,  // tier solicitado é baixo
        userProviders: ['anthropic', 'openai', 'deepseek'],
      })
      expect(result.model.tierCapability).toBe(3)
    })
  })

  describe('scoring — modelo correto por contexto', () => {
    it('prefere modelo com força "security" para quality_council/security', () => {
      const result = selector.select({
        stage: 'quality_council',
        operation: 'security',
        tier: 3,
        qualityDimension: 'security',
        userProviders: ['anthropic', 'deepseek'],
      })
      expect(result.model.strengths).toContain('security')
    })

    it('prefere modelo local/gratuito quando preferFreeTier é true', () => {
      const result = selector.select({
        stage: 'docs_final',
        operation: 'readme',
        tier: 1,
        preferFreeTier: true,
        userProviders: ['anthropic'],  // tem key paga, mas preferiu gratuito
      })
      expect(result.model.hasFreeTier || result.model.isLocal).toBe(true)
    })
  })

  describe('updatePerformance — learning loop', () => {
    it('aumenta o score de um modelo após aprovação humana', () => {
      const modelId = 'deepseek-v4-flash'
      selector.updatePerformance(modelId, 'tests', undefined, true, 0.85, 0.001, 980)
      const scores = selector.getPerformanceHistory()
      const record = scores.find(r => r.modelId === modelId && r.stage === 'tests')
      expect(record?.humanApprovals).toBe(1)
      expect(record?.performanceScore).toBeGreaterThan(0.5)
    })
  })
})
```

### Pipeline reducers — imutabilidade
```typescript
// __tests__/unit/pipeline-reducers.test.ts
import { describe, it, expect } from 'vitest'
import { createProjectRun } from '@/lib/devfactory/types'

// Importar os reducers (extrair para arquivo próprio se estiverem em pipeline-workflow.ts)

describe('Pipeline reducers — imutabilidade', () => {
  it('initStage não muta o run original', () => {
    const run = createProjectRun({ id: '1', userId: 'u1', projectId: 'p1', projectName: 'Test', briefing: 'test briefing with enough words here', userProviders: [] })
    const frozen = Object.freeze({ ...run })
    const next = initStage(frozen as any, 'planning')
    expect(next).not.toBe(frozen)
    expect(next.currentStage).toBe('planning')
  })

  it('appendIteration acumula custo corretamente', () => {
    let run = createProjectRun({ id: '1', userId: 'u1', projectId: 'p1', projectName: 'Test', briefing: 'test briefing', userProviders: [] })
    run = initStage(run, 'planning')
    run = appendIteration(run, 'planning', {
      iterationNumber: 1,
      operation: 'prd',
      routerOutput: {} as any,
      selectionResult: { estimatedCostUsd: 0.005 } as any,
      agentOutput: {},
      selfCritique: { score: 0.8, passed: true, issues: [] },
      startedAt: new Date().toISOString(),
    })
    expect(run.totalCostUsd).toBeCloseTo(0.005)
    expect(run.stages.planning?.iterations).toHaveLength(1)
  })
})
```

---

## Testes de integração

### Workflow pipeline com MSW
```typescript
// __tests__/integration/pipeline-workflow.test.ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

const server = setupServer(
  // Mock do Complexity Router (Gemini Flash-Lite)
  http.post('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', () =>
    HttpResponse.json({
      choices: [{ message: { content: JSON.stringify({
        ambiguity_score: 0.3, ambiguity_reason: 'spec clara',
        criticality_score: 0.4, criticality_reason: 'risco moderado',
        novelty_score: 0.2, novelty_reason: 'padrão existente',
        tier: 1, confidence: 0.85,
        reason: 'Operação simples de boilerplate.',
        escalation_hint: null,
      }) } }],
    })
  ),

  // Mock do AgentRunner (DeepSeek Flash)
  http.post('https://api.deepseek.com/v1/chat/completions', () =>
    HttpResponse.json({
      choices: [{ message: { content: JSON.stringify({
        files: [{ path: 'src/index.ts', content: 'export {}' }],
      }) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 500, completion_tokens: 200 },
    })
  ),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('runSingleStageStep', () => {
  it('chama router, seleciona modelo e retorna iteration válido', async () => {
    const run = createTestRun({ userProviders: [] })  // só modelos gratuitos
    const result = await runSingleStageStep(run, 'docs_final', 1)
    expect(result.iteration.selfCritique.score).toBeGreaterThan(0)
    expect(result.iteration.selectionResult.model.hasFreeTier).toBe(true)
  })

  it('lança FatalError quando tier exige modelo pago sem BYOK', async () => {
    const run = createTestRun({ userProviders: [] })
    await expect(runSingleStageStep(run, 'planning', 3)).rejects.toThrow('FatalError')
  })
})
```

### API routes
```typescript
// __tests__/integration/api/runs.test.ts
import { describe, it, expect } from 'vitest'
import { testApiHandler } from 'next-test-api-route-handler'
import * as runsHandler from '@/app/api/runs/route'

describe('POST /api/runs', () => {
  it('retorna 401 sem sessão', async () => {
    await testApiHandler({
      appHandler: runsHandler,
      test: async ({ fetch }) => {
        const res = await fetch({ method: 'POST', body: JSON.stringify({ projectName: 'Test', briefing: 'x' }) })
        expect(res.status).toBe(401)
      },
    })
  })

  it('retorna 400 sem briefing em modo greenfield', async () => {
    await testApiHandler({
      appHandler: runsHandler,
      test: async ({ fetch }) => {
        const res = await fetch({
          method: 'POST',
          headers: { 'x-test-user-id': 'usr_test' },  // mock de auth
          body: JSON.stringify({ projectName: 'Test' }),  // sem briefing
        })
        expect(res.status).toBe(400)
        const body = await res.json()
        expect(body.error).toMatch(/briefing/)
      },
    })
  })
})
```

---

## Testes E2E (Playwright)

### Configuração
```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './__tests__/e2e',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile',   use: { ...devices['Pixel 7'] } },  // responsividade
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
})
```

### Fluxo de aprovação de gate
```typescript
// __tests__/e2e/gate-approve.spec.ts
import { test, expect } from '@playwright/test'
import { AxeBuilder } from '@axe-core/playwright'

test.describe('Gate humano', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.fill('[placeholder="seu@email.com"]', 'test@devfactory.app')
    await page.click('button:has-text("Enviar link mágico")')
    await page.waitForURL('/dashboard')
  })

  test('usuário aprova etapa e pipeline avança', async ({ page }) => {
    // Criar run via API (mais rápido que UI)
    const res = await page.request.post('/api/runs', {
      data: { projectId: 'test-p1', projectName: 'E2E Test', briefing: 'Criar uma API REST mínima para gerenciar tarefas de um usuário. Node.js + TypeScript + Supabase.' },
    })
    const { runId } = await res.json()

    await page.goto(`/runs/${runId}`)
    await page.waitForSelector('[data-testid="awaiting-human-badge"]', { timeout: 30000 })

    // Stage atual visível
    await expect(page.locator('[data-testid="current-stage"]')).toContainText('planning')

    // Clicar aprovação
    await page.click('[data-testid="approve-button"]')
    await expect(page.locator('[data-testid="stage-status-planning"]')).toContainText('✓')
  })

  test('pipeline gate tem acessibilidade WCAG 2.2 AA', async ({ page }) => {
    await page.goto('/runs/test-run-id')
    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toHaveLength(0)
  })
})
```

### Teste de responsividade
```typescript
// __tests__/e2e/responsive.spec.ts
test.describe('Responsividade', () => {
  const viewports = [
    { name: 'Mobile S', width: 320, height: 568 },
    { name: 'Mobile M', width: 375, height: 812 },
    { name: 'Tablet',   width: 768, height: 1024 },
    { name: 'Desktop',  width: 1280, height: 800 },
  ]

  for (const vp of viewports) {
    test(`Dashboard renderiza corretamente em ${vp.name}`, async ({ page }) => {
      await page.setViewportSize(vp)
      await page.goto('/dashboard')
      // FAB visível em mobile, botão inline em desktop
      if (vp.width < 600) {
        await expect(page.locator('[aria-label="Novo Projeto"]')).toBeVisible()
        await expect(page.locator('button:has-text("Novo Projeto")')).toHaveCount(1)
      } else {
        await expect(page.locator('button:has-text("Novo Projeto")')).toBeVisible()
      }
      // Sem overflow horizontal
      const hasHorizontalScroll = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth
      )
      expect(hasHorizontalScroll).toBe(false)
    })
  }
})
```

---

## Cobertura mínima (CI bloqueia se abaixo)

| Camada | Meta |
|---|---|
| `lib/devfactory/*.ts` | 80% de statements, 75% de branches |
| `app/api/**` | 70% de statements |
| Fluxos E2E críticos | 100% (login, criar run, aprovar gate, rejeitar gate) |
| Páginas testadas por axe-core | 100% das páginas do app |

---

## Scripts de teste

```json
// package.json
{
  "scripts": {
    "test":        "vitest run",
    "test:watch":  "vitest",
    "test:ui":     "vitest --ui",
    "test:e2e":    "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:a11y":   "playwright test __tests__/e2e/a11y.spec.ts",
    "test:cover":  "vitest run --coverage",
    "test:all":    "vitest run && playwright test"
  }
}
```

---

## CI pipeline (GitHub Actions)

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npx eslint . --ext .ts,.tsx,.jsx --max-warnings 0
      - run: npx vitest run --coverage
      - uses: actions/upload-artifact@v4
        with: { name: coverage, path: coverage/ }

  e2e:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci && npx playwright install --with-deps chromium
      - run: npm run build && npx playwright test
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report, path: playwright-report/ }

  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: returntocorp/semgrep-action@v1
        with: { config: 'p/typescript p/nextjs p/secrets' }
```
