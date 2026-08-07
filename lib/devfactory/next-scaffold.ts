/**
 * DevFactory — Next.js Scaffold
 * lib/devfactory/next-scaffold.ts
 *
 * As etapas "backend" e "frontend" rodam como duas chamadas de LLM
 * separadas (routers/modelos diferentes, sem visão uma da outra) — nenhuma
 * delas tem garantia de emitir os arquivos de raiz que fazem um app Next.js
 * ser reconhecível como tal (package.json, next.config, tsconfig), nem de
 * declarar no package.json os pacotes que o próprio código gerado importa
 * (zod, @supabase/supabase-js, lucide-react...), nem de marcar "use client"
 * em componentes que usam hooks. Cada um desses gaps falha o build de um
 * jeito diferente — sem os arquivos de raiz, "vercel build" nem builda (site
 * fica 404 com deploy READY); com eles mas sem as dependências corretas ou
 * a diretiva "use client", o build falha explicitamente.
 *
 * ensureNextScaffold() cobre os três casos, sempre preservando o que a IA
 * já gerou — só preenche o que falta ou é estruturalmente necessário.
 */

export interface GeneratedFile {
  path:    string
  content: string
}

const DEFAULT_PACKAGE_JSON: Record<string, unknown> = {
  name: 'devfactory-app',
  version: '0.1.0',
  private: true,
  scripts: {
    dev:   'next dev',
    build: 'next build',
    start: 'next start',
  },
  dependencies: {
    next:        '^15.0.0',
    react:       '^19.0.0',
    'react-dom': '^19.0.0',
  },
  devDependencies: {
    typescript:          '^5.5.0',
    '@types/node':       '^20.14.0',
    '@types/react':      '^19.0.0',
    '@types/react-dom':  '^19.0.0',
    tailwindcss:         '^3.4.0',
    postcss:             '^8.4.0',
    autoprefixer:        '^10.4.0',
  },
}

// Sem isso, mesmo quando a IA escreve className="bg-blue-600 rounded-lg
// shadow-lg..." (o padrão mais comum que LLMs usam pra estilizar), essas
// classes não fazem NADA — Tailwind não é só uma lib, é um passo de build
// (PostCSS) que gera o CSS a partir das classes usadas. Sem
// tailwind.config/postcss.config/diretivas @tailwind, o app builda e sobe
// normal, só que 100% sem estilo — visualmente "cru" mesmo com o código
// certo. design/frontend não coordenam entre si nem garantem isso sozinhos.
const DEFAULT_POSTCSS_CONFIG = `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
`

const DEFAULT_TAILWIND_CONFIG = `import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}

export default config
`

const TAILWIND_DIRECTIVES = `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n`

const DEFAULT_NEXT_CONFIG = `/** @type {import('next').NextConfig} */
const nextConfig = {}

module.exports = nextConfig
`

const DEFAULT_TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: 'ES2017',
      lib: ['dom', 'dom.iterable', 'esnext'],
      allowJs: true,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: 'esnext',
      moduleResolution: 'bundler',
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: 'preserve',
      incremental: true,
      plugins: [{ name: 'next' }],
      paths: { '@/*': ['./*'] },
    },
    include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
    exclude: ['node_modules'],
  },
  null,
  2,
)

const DEFAULT_GITIGNORE = `node_modules\n.next\n.env*.local\n`

const FALLBACK_LAYOUT = `import './globals.css'

export const metadata = {
  title: 'DevFactory App',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  )
}
`

const FALLBACK_PAGE = `export default function Page() {
  return <main>App gerado pelo DevFactory.</main>
}
`

const FALLBACK_GLOBALS_CSS = `${TAILWIND_DIRECTIVES}\nhtml, body {\n  padding: 0;\n  margin: 0;\n}\n`

const NEXT_CONFIG_NAMES = ['next.config.js', 'next.config.ts', 'next.config.mjs']
const SOURCE_FILE_PATTERN = /\.(t|j)sx?$/

// ─── Dependências: pacotes que o código gerado importa mas que o npm não
// conhece por padrão (só next/react/react-dom vêm no scaffold base) ─────────

const NODE_BUILTINS = new Set([
  'fs', 'path', 'crypto', 'http', 'https', 'os', 'url', 'util', 'stream',
  'events', 'buffer', 'querystring', 'child_process', 'net', 'zlib',
  'assert', 'dns', 'tty', 'readline', 'process',
])

// Pacotes comuns em geração de SaaS/LP cujo range de versão vale fixar —
// os demais entram com "latest" (resolve o que existir no momento do build).
const KNOWN_VERSIONS: Record<string, string> = {
  zod:                     '^3.23.0',
  '@supabase/supabase-js': '^2.45.0',
  'lucide-react':          '^0.400.0',
  clsx:                    '^2.1.0',
  'date-fns':              '^3.6.0',
  'react-hook-form':       '^7.52.0',
  '@hookform/resolvers':   '^3.9.0',
  bcryptjs:                '^2.4.3',
  jsonwebtoken:            '^9.0.2',
  'framer-motion':         '^11.3.0',
}

const IMPORT_RE = /(?:from\s+['"]([^'"]+)['"])|(?:require\(\s*['"]([^'"]+)['"]\s*\))|(?:import\(\s*['"]([^'"]+)['"]\s*\))/g

function extractBareImports(content: string): string[] {
  const pkgs = new Set<string>()
  let match: RegExpExecArray | null
  IMPORT_RE.lastIndex = 0
  while ((match = IMPORT_RE.exec(content))) {
    const spec = match[1] ?? match[2] ?? match[3]
    if (!spec || spec.startsWith('.') || spec.startsWith('/')) continue
    if (spec.startsWith('@/')) continue // alias local (tsconfig "paths"), não é pacote npm
    if (spec === 'react' || spec === 'react-dom' || spec.startsWith('next')) continue
    if (NODE_BUILTINS.has(spec) || spec.startsWith('node:')) continue
    const pkgName = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]
    pkgs.add(pkgName)
  }
  return [...pkgs]
}

function mergePackageJson(existing: GeneratedFile | undefined, files: GeneratedFile[]): GeneratedFile {
  let pkg: Record<string, unknown>
  try {
    pkg = existing ? JSON.parse(existing.content) : { ...DEFAULT_PACKAGE_JSON }
  } catch {
    pkg = { ...DEFAULT_PACKAGE_JSON }
  }

  pkg.name ??= 'devfactory-app'
  pkg.version ??= '0.1.0'
  pkg.private ??= true
  pkg.scripts = { dev: 'next dev', build: 'next build', start: 'next start', ...(pkg.scripts as object ?? {}) }

  const deps = { ...(pkg.dependencies as Record<string, string> ?? {}) }
  deps.next ??= '^15.0.0'
  deps.react ??= '^19.0.0'
  deps['react-dom'] ??= '^19.0.0'

  const devDeps = { ...(pkg.devDependencies as Record<string, string> ?? {}) }
  devDeps.typescript ??= '^5.5.0'
  devDeps.tailwindcss ??= '^3.4.0'
  devDeps.postcss ??= '^8.4.0'
  devDeps.autoprefixer ??= '^10.4.0'

  const allImported = new Set<string>()
  for (const file of files) {
    if (!SOURCE_FILE_PATTERN.test(file.path)) continue
    for (const pkgName of extractBareImports(file.content)) allImported.add(pkgName)
  }

  for (const pkgName of allImported) {
    if (deps[pkgName] || devDeps[pkgName]) continue
    deps[pkgName] = KNOWN_VERSIONS[pkgName] ?? 'latest'
  }

  pkg.dependencies = deps
  pkg.devDependencies = devDeps

  return { path: 'package.json', content: JSON.stringify(pkg, null, 2) }
}

// ─── "use client": heurística — qualquer .tsx/.jsx que use hooks de estado/
// efeito ou handlers de evento precisa da diretiva, senão o build falha ────

const NEEDS_CLIENT_PATTERN = /\b(useState|useEffect|useRef|useContext|useReducer|useCallback|useMemo|useRouter|usePathname|useSearchParams)\s*\(|on[A-Z]\w*\s*=\s*{/

function ensureUseClientDirective(file: GeneratedFile): GeneratedFile {
  if (!/\.(t|j)sx$/.test(file.path)) return file
  const trimmed = file.content.trimStart()
  if (trimmed.startsWith("'use client'") || trimmed.startsWith('"use client"')) return file
  if (!NEEDS_CLIENT_PATTERN.test(file.content)) return file
  return { path: file.path, content: `'use client'\n\n${file.content}` }
}

// ─── Tailwind: garantir que app/globals.css existe, tem as diretivas
// @tailwind, e é de fato importado pelo layout raiz — as três coisas têm
// que estar certas ao mesmo tempo pra classes Tailwind virarem CSS real.
// Roda depois do fallback de app/layout.tsx/app/page.tsx (ensureNextScaffold
// garante isso pela ordem de chamadas), então app/layout.tsx sempre existe
// neste ponto — da IA ou o fallback.

function ensureTailwindDirectives(file: GeneratedFile): GeneratedFile {
  if (/@tailwind\s+base/.test(file.content)) return file
  return { ...file, content: `${TAILWIND_DIRECTIVES}\n${file.content}` }
}

function ensureTailwindWiring(files: GeneratedFile[]): GeneratedFile[] {
  const result = [...files]

  const layoutIdx = result.findIndex(f => /^app\/layout\.(t|j)sx$/.test(f.path))
  const layout = layoutIdx !== -1 ? result[layoutIdx] : null
  const cssImportMatch = layout?.content.match(/import\s+['"](\.\/[^'"]+\.css)['"]/)

  if (cssImportMatch) {
    // Layout já importa algum CSS (não necessariamente "globals.css") — as
    // diretivas @tailwind têm que entrar NESSE arquivo, senão ele carrega
    // sem Tailwind mesmo com tailwind.config/postcss.config presentes, e um
    // app/globals.css órfão (nunca importado) não ajuda em nada.
    const cssPath = `app/${cssImportMatch[1].replace(/^\.\//, '')}`
    const cssIdx = result.findIndex(f => f.path === cssPath)
    if (cssIdx === -1) {
      result.push({ path: cssPath, content: FALLBACK_GLOBALS_CSS })
    } else {
      result[cssIdx] = ensureTailwindDirectives(result[cssIdx])
    }
  } else {
    const globalsIdx = result.findIndex(f => f.path === 'app/globals.css')
    if (globalsIdx === -1) {
      result.push({ path: 'app/globals.css', content: FALLBACK_GLOBALS_CSS })
    } else {
      result[globalsIdx] = ensureTailwindDirectives(result[globalsIdx])
    }
    if (layoutIdx !== -1) {
      result[layoutIdx] = { ...result[layoutIdx], content: `import './globals.css'\n${result[layoutIdx].content}` }
    }
  }

  return result
}

export function ensureNextScaffold(files: GeneratedFile[]): GeneratedFile[] {
  let result = [...files]
  const paths = new Set(result.map(f => f.path))

  if (!NEXT_CONFIG_NAMES.some(name => paths.has(name))) {
    result.push({ path: 'next.config.js', content: DEFAULT_NEXT_CONFIG })
  }
  if (!paths.has('tsconfig.json')) {
    result.push({ path: 'tsconfig.json', content: DEFAULT_TSCONFIG })
  }
  if (!paths.has('.gitignore')) {
    result.push({ path: '.gitignore', content: DEFAULT_GITIGNORE })
  }
  if (!paths.has('postcss.config.js') && !paths.has('postcss.config.mjs')) {
    result.push({ path: 'postcss.config.js', content: DEFAULT_POSTCSS_CONFIG })
  }
  if (!paths.has('tailwind.config.ts') && !paths.has('tailwind.config.js')) {
    result.push({ path: 'tailwind.config.ts', content: DEFAULT_TAILWIND_CONFIG })
  }

  // Next.js exige um app/layout.tsx pra QUALQUER página existir, inclusive
  // rotas aninhadas — checar isso independente de page.tsx era o bug: se a
  // IA gerasse app/page.tsx mas esquecesse o layout (comum — os prompts
  // pedem "App Router" mas não garantem as duas peças juntas), o
  // APP_ENTRY_PATTERN batia em QUALQUER um dos dois e pulava o fallback do
  // que estava faltando. Build falhava com "page.tsx doesn't have a root
  // layout" mesmo com o site aparentemente completo.
  const hasRootLayout = paths.has('app/layout.tsx')
  const hasAnyPage = result.some(f => /^app\/(.*\/)?page\.(t|j)sx?$/.test(f.path))

  if (!hasRootLayout) result.push({ path: 'app/layout.tsx', content: FALLBACK_LAYOUT })
  if (!hasAnyPage) result.push({ path: 'app/page.tsx', content: FALLBACK_PAGE })

  result = ensureTailwindWiring(result)
  result = result.map(ensureUseClientDirective)

  // package.json por último — precisa ver o resultado final (inclusive os
  // arquivos de fallback acima) pra escanear todos os imports corretamente.
  const existingPkg = result.find(f => f.path === 'package.json')
  const mergedPkg = mergePackageJson(existingPkg, result)
  result = existingPkg
    ? result.map(f => (f.path === 'package.json' ? mergedPkg : f))
    : [...result, mergedPkg]

  return result
}
