/**
 * DevFactory — Next.js Scaffold
 * lib/devfactory/next-scaffold.ts
 *
 * As etapas "backend" e "frontend" rodam como duas chamadas de LLM
 * separadas (routers/modelos diferentes, sem visão uma da outra) — nenhuma
 * delas tem garantia de emitir os arquivos de raiz que fazem um app Next.js
 * ser reconhecível como tal (package.json, next.config, tsconfig). Sem
 * isso, "vercel build" não encontra nada pra buildar e publica os arquivos
 * como estáticos passthrough — o deploy fica READY mas o site é 404.
 *
 * ensureNextScaffold() preenche só o que falta, nunca sobrescreve arquivo
 * já gerado pela IA.
 */

export interface GeneratedFile {
  path:    string
  content: string
}

const DEFAULT_PACKAGE_JSON = JSON.stringify(
  {
    name: 'devfactory-app',
    version: '0.1.0',
    private: true,
    scripts: {
      dev:   'next dev',
      build: 'next build',
      start: 'next start',
    },
    dependencies: {
      next:       '^15.0.0',
      react:      '^19.0.0',
      'react-dom': '^19.0.0',
    },
    devDependencies: {
      typescript:        '^5.5.0',
      '@types/node':     '^20.14.0',
      '@types/react':    '^19.0.0',
      '@types/react-dom': '^19.0.0',
    },
  },
  null,
  2,
)

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

const NEXT_CONFIG_NAMES = ['next.config.js', 'next.config.ts', 'next.config.mjs']
const APP_ENTRY_PATTERN = /^app\/(page|layout)\.(t|j)sx?$/

export function ensureNextScaffold(files: GeneratedFile[]): GeneratedFile[] {
  const paths = new Set(files.map(f => f.path))
  const scaffold: GeneratedFile[] = []

  if (!paths.has('package.json')) {
    scaffold.push({ path: 'package.json', content: DEFAULT_PACKAGE_JSON })
  }
  if (!NEXT_CONFIG_NAMES.some(name => paths.has(name))) {
    scaffold.push({ path: 'next.config.js', content: DEFAULT_NEXT_CONFIG })
  }
  if (!paths.has('tsconfig.json')) {
    scaffold.push({ path: 'tsconfig.json', content: DEFAULT_TSCONFIG })
  }
  if (!paths.has('.gitignore')) {
    scaffold.push({ path: '.gitignore', content: DEFAULT_GITIGNORE })
  }

  const hasAppEntry = files.some(f => APP_ENTRY_PATTERN.test(f.path))
  if (!hasAppEntry) {
    if (!paths.has('app/layout.tsx')) scaffold.push({ path: 'app/layout.tsx', content: FALLBACK_LAYOUT })
    if (!paths.has('app/page.tsx')) scaffold.push({ path: 'app/page.tsx', content: FALLBACK_PAGE })
  }

  return [...files, ...scaffold]
}
