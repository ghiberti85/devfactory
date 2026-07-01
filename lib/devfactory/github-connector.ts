/**
 * DevFactory — GitHub Connector
 * lib/devfactory/github-connector.ts
 *
 * Lê um repositório existente (via GitHub API, com o token do PRÓPRIO usuário
 * — mesmo princípio BYOK das API keys de modelo) e produz um RepoContext
 * estruturado: stack detectada, convenções existentes, docs já escritos,
 * estrutura de pastas. Esse contexto substitui/complementa o briefing em
 * branco quando o projeto está em modo 'brownfield'.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GitHubRepoRef {
  owner: string
  repo: string
  branch?: string // default: branch padrão do repo
}

export interface RepoFile {
  path: string
  content: string
  sizeBytes: number
}

export interface RepoContext {
  repo: GitHubRepoRef
  defaultBranch: string

  // ── Documentação existente ──────────────────────────────────────────────
  readme: string | null
  claudeMd: string | null      // CLAUDE.md, se existir
  contextMd: string | null     // CONTEXT.md, se existir
  docsFiles: RepoFile[]        // conteúdo de docs/**, se existir

  // ── Stack detectada ──────────────────────────────────────────────────────
  detectedStack: {
    language: string[]          // ex: ['TypeScript', 'JavaScript']
    frameworks: string[]        // ex: ['Next.js', 'React']
    packageManager: string | null // 'npm' | 'pnpm' | 'yarn' | 'bun' | null
    testFramework: string | null  // 'jest' | 'vitest' | 'playwright' | null
    cssApproach: string | null    // 'tailwind' | 'css-modules' | 'styled-components' | null
    database: string | null       // detectado via deps (prisma, drizzle, supabase-js...)
  }

  // ── Estrutura ──────────────────────────────────────────────────────────────
  fileTree: string[]            // paths relativos, truncado a um limite razoável
  keyFiles: RepoFile[]          // package.json, tsconfig.json, configs relevantes

  // ── Convenções inferidas (heurística simples; o agente de Planning refina) ──
  conventions: {
    componentNamingPattern: string | null  // ex: 'PascalCase com sufixo .tsx'
    folderStructure: string | null         // ex: 'feature-based' | 'layer-based'
    hasLinting: boolean
    hasTests: boolean
    hasCI: boolean
  }

  fetchedAt: string
  truncated: boolean // true se o repo era grande demais e o conteúdo foi cortado
}

// ─── Formas mínimas da API REST do GitHub usadas aqui ─────────────────────────

interface GitHubRepoMeta {
  default_branch: string
}

interface GitHubTreeNode {
  path: string
  type: string
}

interface GitHubTreeResponse {
  tree: GitHubTreeNode[]
  truncated: boolean
}

interface GitHubContentResponse {
  content?:  string
  encoding?: string
}

interface GitHubRepoListItem {
  owner: { login: string }
  name: string
  full_name: string
  private: boolean
  default_branch: string
  updated_at: string
  description: string | null
}

// ─── GitHub API client (mínimo, sem dependências externas) ───────────────────

const GITHUB_API = 'https://api.github.com'

async function ghFetch<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!res.ok) {
    if (res.status === 404) throw new Error('Repositório não encontrado ou sem acesso.')
    if (res.status === 401 || res.status === 403) throw new Error('Token do GitHub inválido ou sem permissão.')
    throw new Error(`GitHub API ${res.status}: ${await res.text()}`)
  }
  return res.json() as Promise<T>
}

async function ghFetchRaw(path: string, token: string): Promise<string | null> {
  try {
    const data = await ghFetch<GitHubContentResponse>(path, token)
    if (data.content && data.encoding === 'base64') {
      return Buffer.from(data.content, 'base64').toString('utf-8')
    }
    return null
  } catch {
    return null // arquivo não existe — comportamento esperado na maioria dos casos
  }
}

// ─── Limites de segurança (evitar estourar contexto do modelo) ───────────────

const MAX_FILES_IN_TREE = 400
const MAX_KEY_FILE_BYTES = 30_000
const MAX_DOCS_FILES = 15

// ─── Detecção de stack a partir do package.json ───────────────────────────────

function detectStackFromPackageJson(pkgJsonRaw: string | null): RepoContext['detectedStack'] {
  const empty: RepoContext['detectedStack'] = {
    language: [], frameworks: [], packageManager: null, testFramework: null, cssApproach: null, database: null,
  }
  if (!pkgJsonRaw) return empty

  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
  try { pkg = JSON.parse(pkgJsonRaw) } catch { return empty }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const has = (name: string) => Boolean(deps[name])

  const frameworks: string[] = []
  if (has('next')) frameworks.push('Next.js')
  if (has('react') && !has('next')) frameworks.push('React')
  if (has('vue')) frameworks.push('Vue')
  if (has('express')) frameworks.push('Express')
  if (has('fastify')) frameworks.push('Fastify')
  if (has('hono')) frameworks.push('Hono')
  if (has('@nestjs/core')) frameworks.push('NestJS')

  const testFramework =
    has('vitest') ? 'vitest' :
    has('jest') ? 'jest' :
    has('@playwright/test') ? 'playwright' : null

  const cssApproach =
    has('tailwindcss') ? 'tailwind' :
    has('styled-components') ? 'styled-components' :
    has('@emotion/react') ? 'emotion' : null

  const database =
    has('@prisma/client') ? 'Prisma' :
    has('drizzle-orm') ? 'Drizzle' :
    has('@supabase/supabase-js') ? 'Supabase' :
    has('mongoose') ? 'MongoDB (Mongoose)' : null

  const language = ['JavaScript']
  if (has('typescript')) language.unshift('TypeScript')

  return { language, frameworks, packageManager: null, testFramework, cssApproach, database }
}

function detectPackageManager(fileTree: string[]): string | null {
  if (fileTree.includes('pnpm-lock.yaml')) return 'pnpm'
  if (fileTree.includes('yarn.lock')) return 'yarn'
  if (fileTree.includes('bun.lockb')) return 'bun'
  if (fileTree.includes('package-lock.json')) return 'npm'
  return null
}

// ─── Função principal ──────────────────────────────────────────────────────────

export async function fetchRepoContext(
  ref: GitHubRepoRef,
  userGithubToken: string,
): Promise<RepoContext> {
  const repoMeta = await ghFetch<GitHubRepoMeta>(`/repos/${ref.owner}/${ref.repo}`, userGithubToken)
  const branch = ref.branch ?? repoMeta.default_branch

  // Árvore completa (recursiva) — uma chamada só
  const treeData = await ghFetch<GitHubTreeResponse>(
    `/repos/${ref.owner}/${ref.repo}/git/trees/${branch}?recursive=1`,
    userGithubToken,
  )

  const allPaths: string[] = (treeData.tree ?? [])
    .filter(n => n.type === 'blob')
    .map(n => n.path)

  const truncated = allPaths.length > MAX_FILES_IN_TREE || treeData.truncated === true
  const fileTree = allPaths.slice(0, MAX_FILES_IN_TREE)

  // Documentação no topo do repo
  const [readme, claudeMd, contextMd, packageJsonRaw, tsconfigRaw] = await Promise.all([
    ghFetchRaw(`/repos/${ref.owner}/${ref.repo}/contents/README.md?ref=${branch}`, userGithubToken),
    ghFetchRaw(`/repos/${ref.owner}/${ref.repo}/contents/CLAUDE.md?ref=${branch}`, userGithubToken),
    ghFetchRaw(`/repos/${ref.owner}/${ref.repo}/contents/CONTEXT.md?ref=${branch}`, userGithubToken),
    ghFetchRaw(`/repos/${ref.owner}/${ref.repo}/contents/package.json?ref=${branch}`, userGithubToken),
    ghFetchRaw(`/repos/${ref.owner}/${ref.repo}/contents/tsconfig.json?ref=${branch}`, userGithubToken),
  ])

  // Pasta docs/ — busca só os primeiros N arquivos para não estourar contexto
  const docsPaths = fileTree.filter(p => p.startsWith('docs/')).slice(0, MAX_DOCS_FILES)
  const docsFiles: RepoFile[] = await Promise.all(
    docsPaths.map(async (path): Promise<RepoFile> => {
      const content = await ghFetchRaw(`/repos/${ref.owner}/${ref.repo}/contents/${path}?ref=${branch}`, userGithubToken)
      return { path, content: (content ?? '').slice(0, MAX_KEY_FILE_BYTES), sizeBytes: content?.length ?? 0 }
    }),
  )

  const keyFiles: RepoFile[] = [
    packageJsonRaw && { path: 'package.json', content: packageJsonRaw.slice(0, MAX_KEY_FILE_BYTES), sizeBytes: packageJsonRaw.length },
    tsconfigRaw && { path: 'tsconfig.json', content: tsconfigRaw.slice(0, MAX_KEY_FILE_BYTES), sizeBytes: tsconfigRaw.length },
  ].filter(Boolean) as RepoFile[]

  const detectedStack = detectStackFromPackageJson(packageJsonRaw)
  detectedStack.packageManager = detectPackageManager(fileTree)

  const conventions: RepoContext['conventions'] = {
    componentNamingPattern: fileTree.some(p => /[A-Z][a-zA-Z]*\.(tsx|jsx)$/.test(p)) ? 'PascalCase' : null,
    folderStructure: fileTree.some(p => p.startsWith('features/') || p.startsWith('src/features/')) ? 'feature-based' : 'layer-based',
    hasLinting: fileTree.some(p => /\.eslintrc|eslint\.config\./.test(p)),
    hasTests: fileTree.some(p => /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(p)),
    hasCI: fileTree.some(p => p.startsWith('.github/workflows/')),
  }

  return {
    repo: ref,
    defaultBranch: branch,
    readme,
    claudeMd,
    contextMd,
    docsFiles,
    detectedStack,
    fileTree,
    keyFiles,
    conventions,
    fetchedAt: new Date().toISOString(),
    truncated,
  }
}

// ─── Lista de repositórios do usuário (para o picker no NewProjectForm) ──────

export interface RepoSummary {
  owner: string
  repo: string
  fullName: string
  private: boolean
  defaultBranch: string
  updatedAt: string
  description: string | null
}

export async function listUserRepos(userGithubToken: string): Promise<RepoSummary[]> {
  const data = await ghFetch<GitHubRepoListItem[]>('/user/repos?sort=updated&per_page=50', userGithubToken)
  return data.map(r => ({
    owner: r.owner.login,
    repo: r.name,
    fullName: r.full_name,
    private: r.private,
    defaultBranch: r.default_branch,
    updatedAt: r.updated_at,
    description: r.description,
  }))
}

// ─── Serialização do RepoContext para prompt ──────────────────────────────────
// Usado pela etapa "Codebase Analysis" e injetado nas etapas seguintes.

export function repoContextToPromptSummary(ctx: RepoContext): string {
  const parts: string[] = []

  parts.push(`Repositório: ${ctx.repo.owner}/${ctx.repo.repo} (branch: ${ctx.defaultBranch})`)

  if (ctx.detectedStack.language.length || ctx.detectedStack.frameworks.length) {
    parts.push(
      `Stack detectada: ${[...ctx.detectedStack.language, ...ctx.detectedStack.frameworks].join(', ')}` +
      (ctx.detectedStack.packageManager ? ` · gerenciador: ${ctx.detectedStack.packageManager}` : '') +
      (ctx.detectedStack.testFramework ? ` · testes: ${ctx.detectedStack.testFramework}` : '') +
      (ctx.detectedStack.cssApproach ? ` · CSS: ${ctx.detectedStack.cssApproach}` : '') +
      (ctx.detectedStack.database ? ` · banco: ${ctx.detectedStack.database}` : '')
    )
  }

  parts.push(
    `Convenções: estrutura ${ctx.conventions.folderStructure ?? 'não identificada'}, ` +
    `${ctx.conventions.hasLinting ? 'com' : 'sem'} linting, ` +
    `${ctx.conventions.hasTests ? 'com' : 'sem'} testes existentes, ` +
    `${ctx.conventions.hasCI ? 'com' : 'sem'} CI configurado.`
  )

  if (ctx.claudeMd) parts.push(`\nCLAUDE.md existente (seguir estas instruções):\n${ctx.claudeMd.slice(0, 2000)}`)
  if (ctx.contextMd) parts.push(`\nCONTEXT.md existente:\n${ctx.contextMd.slice(0, 2000)}`)
  if (ctx.readme) parts.push(`\nREADME atual:\n${ctx.readme.slice(0, 1500)}`)

  if (ctx.docsFiles.length) {
    parts.push(`\nDocumentação em docs/ (${ctx.docsFiles.length} arquivos):`)
    ctx.docsFiles.forEach(f => parts.push(`— ${f.path}:\n${f.content.slice(0, 800)}`))
  }

  parts.push(`\nÁrvore de arquivos (${ctx.fileTree.length}${ctx.truncated ? '+, truncada' : ''}):\n${ctx.fileTree.slice(0, 150).join('\n')}`)

  return parts.join('\n')
}
