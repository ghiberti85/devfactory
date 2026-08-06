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
  },
}

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

const FALLBACK_LAYOUT = `export const metadata = {
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

const FALLBACK_GLOBALS_CSS = `html, body {\n  padding: 0;\n  margin: 0;\n}\n`

const NEXT_CONFIG_NAMES = ['next.config.js', 'next.config.ts', 'next.config.mjs']
const APP_ENTRY_PATTERN = /^app\/(page|layout)\.(t|j)sx?$/
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

// ─── globals.css: se algo importa "./globals.css" (convenção do template
// padrão do create-next-app) mas o arquivo não foi gerado ──────────────────

function ensureGlobalsCss(files: GeneratedFile[]): GeneratedFile[] {
  const referencesGlobalsCss = files.some(
    f => SOURCE_FILE_PATTERN.test(f.path) && /['"]\.\/globals\.css['"]/.test(f.content),
  )
  const hasGlobalsCss = files.some(f => f.path === 'app/globals.css')
  if (referencesGlobalsCss && !hasGlobalsCss) {
    return [...files, { path: 'app/globals.css', content: FALLBACK_GLOBALS_CSS }]
  }
  return files
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

  const hasAppEntry = result.some(f => APP_ENTRY_PATTERN.test(f.path))
  if (!hasAppEntry) {
    if (!paths.has('app/layout.tsx')) result.push({ path: 'app/layout.tsx', content: FALLBACK_LAYOUT })
    if (!paths.has('app/page.tsx')) result.push({ path: 'app/page.tsx', content: FALLBACK_PAGE })
  }

  result = ensureGlobalsCss(result)
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
