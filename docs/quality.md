# Qualidade — Performance, SEO, Acessibilidade e Responsividade

> Padrões e orçamentos de qualidade para todas as dimensões que o Quality Council avalia automaticamente.

---

## Performance

### Budget (Lighthouse — CI bloqueia se não atingir)

| Métrica | Target | Máximo tolerado |
|---|---|---|
| Time to First Byte (TTFB) | < 800ms | 1.2s |
| First Contentful Paint (FCP) | < 1.8s | 2.5s |
| Largest Contentful Paint (LCP) | < 2.5s | 4.0s |
| Time to Interactive (TTI) | < 3.5s | 5.0s |
| Cumulative Layout Shift (CLS) | < 0.1 | 0.25 |
| Total Blocking Time (TBT) | < 200ms | 600ms |
| Lighthouse Score | > 90 | 80 |

### Next.js — padrões de implementação

```typescript
// ✅ Server Components para dados que não precisam de interatividade
// app/dashboard/page.tsx
export default async function DashboardPage() {
  // Data fetching no servidor — zero bundle no cliente
  const summary = await getRunsSummary()  // server-side
  return <Dashboard initialSummary={summary} />
}

// ✅ Lazy loading para componentes pesados
const ModelLeaderboard = lazy(() => import('@/components/ModelLeaderboard'))
const QualityRadar     = lazy(() => import('@/components/QualityRadar'))

// ✅ Imagens com next/image (otimização automática + CLS zero)
import Image from 'next/image'
<Image src="/logo.svg" alt="DevFactory" width={26} height={26} priority />

// ✅ Prefetch de rotas críticas
import Link from 'next/link'
<Link href="/projects/new" prefetch>Novo Projeto</Link>

// ❌ Evitar — importa tudo de recharts de uma vez
import { BarChart, LineChart, RadarChart, ... } from 'recharts'

// ✅ Tree-shaking funciona melhor com named imports do subpath
import { BarChart, Bar, XAxis, YAxis } from 'recharts'
```

### Bundle size
```bash
# Analisar bundle
npx @next/bundle-analyzer

# Budget: nenhum chunk maior que 250kB (gzipped)
# Chunks do Dashboard: dividir por tab (Overview, Models, Learning)
```

### Fonts
```typescript
// next/font — zero layout shift, auto-hosted
import { Inter } from 'next/font/google'
import localFont from 'next/font/local'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

// JetBrains Mono para código/monospace
const jetbrainsMono = localFont({
  src: '../public/fonts/JetBrainsMono-Variable.woff2',
  variable: '--font-mono',
  display: 'swap',
})
```

### Caching
```typescript
// Server Component: cache por 60s, revalidar em background
export const revalidate = 60

// Route handler: cache de dados quase estáticos (model registry)
export async function GET() {
  const models = await getModels()
  return NextResponse.json(models, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
  })
}

// Dados do usuário: sem cache compartilhado (privado por usuário)
return NextResponse.json(runs, {
  headers: { 'Cache-Control': 'private, no-cache' },
})
```

### Streaming UI (loading states)
```typescript
// app/dashboard/loading.tsx — Suspense boundary automático do Next.js
export default function DashboardLoading() {
  return (
    <div aria-busy="true" aria-label="Carregando dashboard...">
      {/* Skeleton que espelha o layout real */}
      <SkeletonSummaryRow />
      <SkeletonChart />
    </div>
  )
}
```

---

## SEO

### Metadata dinâmica
```typescript
// app/layout.tsx — base
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: { default: 'DevFactory', template: '%s — DevFactory' },
  description: 'Fábrica de software autônoma orquestrada por IA. Pipeline de 9 etapas com modelos dinâmicos e validação humana.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://devfactory.app'),
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    siteName: 'DevFactory',
  },
  robots: { index: false, follow: false },  // app privada — não indexar
}

// app/dashboard/page.tsx — página específica
export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Visão geral dos seus runs, custos e performance dos modelos.',
}
```

### Estrutura semântica
```tsx
// ✅ Landmarks semânticos em toda página
<header>
  <nav aria-label="Navegação principal">...</nav>
</header>
<main>
  <h1>Dashboard</h1>
  <section aria-labelledby="runs-heading">
    <h2 id="runs-heading">Runs Recentes</h2>
    ...
  </section>
</main>

// ✅ Tabelas com captions e headers
<table>
  <caption className="sr-only">Lista de runs da pipeline</caption>
  <thead>
    <tr>
      <th scope="col">Projeto</th>
      <th scope="col">Status</th>
    </tr>
  </thead>
</table>
```

---

## Acessibilidade (WCAG 2.2 AA)

### Checklist por componente

#### Foco e teclado
```tsx
// ✅ Foco visível em todos os elementos interativos
// (nunca remover outline sem substituir)
button:focus-visible { outline: 2px solid var(--color-violet); outline-offset: 2px; }

// ✅ Ordem de foco lógica (Tab deve seguir a ordem visual)
// Não usar tabIndex > 0

// ✅ Modais fecham com Escape e devolvem o foco ao trigger
function InfoModal({ onClose }) {
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  // Ao fechar, devolver foco ao botão que abriu
  const handleClose = () => {
    onClose()
    triggerRef.current?.focus()
  }
  // ...
}

// ✅ Navegação por teclado em listas/menus customizados
function TabSwitcher({ tabs, activeTab, onChange }) {
  return (
    <div role="tablist">
      {tabs.map(tab => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={activeTab === tab.id}
          aria-controls={`panel-${tab.id}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
```

#### Cores e contraste
```typescript
// Tokens de cor do projeto (objeto T em cada componente)
// Verificar: https://webaim.org/resources/contrastchecker/

// Combinações aprovadas (fundo bg0 #080808):
// text0 #f1f5f9 sobre bg0 → razão 18.5:1 ✅ AAA
// text1 #94a3b8 sobre bg0 → razão 7.2:1  ✅ AA
// text2 #475569 sobre bg0 → razão 3.8:1  ⚠️ FAIL para texto normal, OK para UI grande
// violet #a78bfa sobre bg0 → razão 6.1:1 ✅ AA

// ❌ text2 (#475569) nunca para texto crítico — usar só como label secundário
// ❌ Nunca transmitir informação SOMENTE por cor
// ✅ Badges de status usam cor + ícone/texto
<span style={{ color: T.green }}>✓ configurada</span>  // cor + ícone
<span style={{ color: T.red }}>✗ erro</span>
```

#### ARIA
```tsx
// ✅ Botões sem texto visível precisam de aria-label
<button
  onClick={onNewProject}
  aria-label="Novo Projeto"
  style={{ /* FAB mobile */ }}
>
  ➕
</button>

// ✅ Status dinâmico com aria-live
<div aria-live="polite" aria-atomic="true">
  {status === 'awaiting_human' && 'Aguardando sua revisão na etapa ' + currentStage}
</div>

// ✅ Loading states
<div aria-busy={isLoading} aria-label="Carregando modelos...">
  {isLoading ? <Skeleton /> : <ModelList />}
</div>

// ✅ Ícones decorativos escondidos
<span aria-hidden="true">🏭</span>
<span className="sr-only">DevFactory</span>

// ✅ Painéis de tabs com aria roles completos
<div id={`panel-${tab.id}`} role="tabpanel" aria-labelledby={tab.id} hidden={activeTab !== tab.id}>
  {children}
</div>
```

#### Formulários
```tsx
// ✅ Todo campo tem label associado (não só placeholder)
<label htmlFor="project-name">Nome do projeto</label>
<input
  id="project-name"
  placeholder="ex: LIV Incorporadora — Site Institucional"
  aria-required="true"
  aria-describedby="project-name-hint"
/>
<span id="project-name-hint" className="sr-only">
  Mínimo 3 caracteres
</span>

// ✅ Erros de validação acessíveis
{error && (
  <span role="alert" aria-live="assertive" style={{ color: T.red }}>
    {error}
  </span>
)}
```

### Classes utilitárias de acessibilidade
```css
/* Screen-reader only — visível para leitores de tela, invisível na tela */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* Respeitar preferência de redução de movimento */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### Teste de acessibilidade
```typescript
// Rodar em cada página no CI
import { AxeBuilder } from '@axe-core/playwright'

test('acessibilidade — dashboard', async ({ page }) => {
  await page.goto('/dashboard')
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations).toHaveLength(0)
})
```

---

## Responsividade

### Breakpoints
```typescript
// lib/breakpoints.ts — fonte única da verdade
export const breakpoints = {
  mobile: 600,   // < 600px: layout de coluna única, FAB
  tablet: 900,   // 600-900px: 1 coluna, sem sidebar
  desktop: 1280, // > 900px: 2+ colunas, botão inline
} as const

// Hook reutilizável
export function useBreakpoint() {
  const [width, setWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : 900
  )
  useEffect(() => {
    const h = () => setWidth(window.innerWidth)
    window.addEventListener('resize', h, { passive: true })
    return () => window.removeEventListener('resize', h)
  }, [])
  return {
    isMobile:  width < breakpoints.mobile,
    isTablet:  width < breakpoints.tablet,
    isDesktop: width >= breakpoints.tablet,
    width,
  }
}
```

### Padrões de layout
```typescript
// ✅ Grid responsivo com fallback
const grid2 = {
  display: 'grid',
  gridTemplateColumns: isTablet ? '1fr' : '1fr 1fr',
  gap: 12,
}

// ✅ FAB em mobile, botão inline em desktop
{isMobile ? (
  <button aria-label="Novo Projeto" style={{ /* fixed, bottom-right */ }}>➕</button>
) : (
  <button>➕ Novo Projeto</button>
)}

// ✅ Tabelas viram cards em mobile
{isMobile ? (
  <RunsCardList runs={runs} />
) : (
  <RunsTable runs={runs} />
)}

// ✅ Padding adaptativo
padding: isMobile ? '14px 12px 90px' : '20px 24px 40px'
//                                ↑ 90px para não cobrir o FAB mobile
```

### Touch targets
```css
/* Todo elemento interativo: mínimo 44×44px (WCAG 2.5.5) */
button, a, [role="button"] {
  min-height: 44px;
  min-width: 44px;
  /* Para botões pequenos com padding pequeno: */
  padding: 10px 16px;
}

/* FAB mobile */
.fab {
  width: 52px;
  height: 52px;
  border-radius: 50%;
}
```

### Teste de responsividade
```typescript
const viewports = [
  { name: 'iPhone SE',  width: 375,  height: 667  },
  { name: 'iPhone 15',  width: 393,  height: 852  },
  { name: 'Pixel 7',    width: 412,  height: 915  },
  { name: 'iPad Mini',  width: 768,  height: 1024 },
  { name: 'Desktop',    width: 1280, height: 800  },
]

// Para cada viewport:
// - sem overflow horizontal
// - elementos interativos ≥ 44px
// - texto legível (font-size ≥ 14px nos elementos primários)
// - FAB visível e clicável em mobile
// - tabs sem overflow em mobile
```

---

## Checklist Quality Council (o que o agente verifica)

### Segurança (Semgrep)
- [ ] Sem secrets hard-coded
- [ ] Sem SQL por concatenação de string
- [ ] Sem `eval()` ou `new Function()`
- [ ] Sem `dangerouslySetInnerHTML` sem sanitização
- [ ] Inputs validados com Zod antes de qualquer uso

### Performance (Lighthouse CI)
- [ ] LCP < 2.5s em conexão 3G simulada
- [ ] CLS < 0.1 (sem shifts de layout)
- [ ] Imagens com dimensões explícitas (previne CLS)
- [ ] Fonts com `display: swap` (previne FOIT)
- [ ] JavaScript não bloqueante (sem scripts síncronos no `<head>`)

### SEO (Lighthouse)
- [ ] `<title>` único por página
- [ ] `<meta name="description">` presente
- [ ] `<h1>` único por página
- [ ] Hierarquia de headings sem saltos (h1 → h2 → h3)
- [ ] Links com texto descritivo (sem "clique aqui")
- [ ] Sitemap se páginas públicas existirem

### Acessibilidade (axe-core)
- [ ] Zero violations WCAG 2.2 AA
- [ ] Contraste mínimo 4.5:1 para texto normal
- [ ] Todos os elementos interativos acessíveis por teclado
- [ ] Foco visível em todos os elementos interativos
- [ ] Imagens com alt text (ou `alt=""` se decorativas)
- [ ] Formulários com labels associados

### Boas práticas (ESLint)
- [ ] Zero warnings ESLint com `--max-warnings 0`
- [ ] TypeScript sem `any` implícito
- [ ] React hooks com dependencies corretas
- [ ] Sem console.log em código de produção
- [ ] Imports não usados removidos
