/**
 * DevFactory — Vercel Deployer
 * lib/devfactory/vercel-deployer.ts
 *
 * Fase 4 do deploy automático: cria um projeto Vercel linkado ao
 * repositório GitHub já criado (Fase 3) e dispara o primeiro deploy.
 * Sempre com o token do PRÓPRIO usuário (getUserVercelToken) — o
 * hosting é cobrado na conta dele, nunca na do DevFactory.
 */

const VERCEL_API = 'https://api.vercel.com'

export class VercelApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'VercelApiError'
  }
}

async function vercelFetch<T>(
  path: string,
  accessToken: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${VERCEL_API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  if (!res.ok) {
    const body = await res.text()
    throw new VercelApiError(
      res.status,
      `Vercel API ${init.method ?? 'GET'} ${path} → ${res.status}: ${body}`,
    )
  }
  return res.json() as Promise<T>
}

// Nome de projeto Vercel: minúsculo, só [a-z0-9-._], até 100 chars.
export function vercelSlugifyProjectName(name: string): string {
  const slug = name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90)
  return slug || 'devfactory-project'
}

export interface VercelProjectRef {
  id:   string
  name: string
}

interface VercelCreateProjectResponse {
  id: string
  name: string
}

export async function createVercelProject(
  name: string,
  gitRepo: { owner: string; repo: string },
  accessToken: string,
): Promise<VercelProjectRef> {
  try {
    const data = await vercelFetch<VercelCreateProjectResponse>('/v11/projects', accessToken, {
      method: 'POST',
      body: {
        name,
        framework: 'nextjs',
        gitRepository: { repo: `${gitRepo.owner}/${gitRepo.repo}`, type: 'github' },
      },
    })
    return { id: data.id, name: data.name }
  } catch (err) {
    if (!(err instanceof VercelApiError) || err.status !== 409) throw err
    // Nome já usado por um projeto existente (ex.: tentativa anterior a esta
    // correção, quando createVercelProject ainda não passava framework:
    // 'nextjs') — reaproveita em vez de falhar, mas PATCH pra garantir que
    // o framework está correto agora. Sem isso, um projeto criado antes
    // dessa mudança fica preso pra sempre com o preset mal detectado
    // ("Other", esperando uma pasta public/ estática) mesmo depois do app
    // gerado buildar com sucesso — visto em produção: "No Output Directory
    // named 'public' found" com o build do Next.js já compilado e ok.
    const existing = await vercelFetch<VercelCreateProjectResponse>(
      `/v9/projects/${encodeURIComponent(name)}`,
      accessToken,
    )
    await vercelFetch(`/v9/projects/${encodeURIComponent(existing.id)}`, accessToken, {
      method: 'PATCH',
      // outputDirectory: null reseta um valor explícito herdado da
      // primeira detecção errada (ex.: "public") de volta pro default do
      // framework (.next) — só setar framework não sobrescreve isso.
      body: { framework: 'nextjs', outputDirectory: null },
    })
    return { id: existing.id, name: existing.name }
  }
}

// ─── Env vars ────────────────────────────────────────────────────────────────
// A etapa "backend" já declara no próprio output (env_vars[]) quais variáveis
// o código gerado espera em runtime — mas o projeto Vercel criado aqui não
// tem nenhuma configurada, e várias dessas variáveis são lidas no TOPO do
// módulo (ex.: `createClient(process.env.SUPABASE_URL!, ...)` fora de
// qualquer função), o que o Next.js executa durante "collect page data" no
// próprio build — sem elas, o build falha (visto em produção: "supabaseUrl
// is required"), não só o runtime.
//
// DevFactory não provisiona um backend de verdade pro app gerado (isso exigiria
// criar um projeto Supabase novo por run, fora de escopo aqui) — então usa
// placeholders só pra destravar o build. O usuário troca pelos valores reais
// nas configurações do projeto na Vercel depois.
function placeholderEnvValue(key: string): string {
  const upper = key.toUpperCase()
  if (upper.includes('SUPABASE_URL')) return 'https://placeholder.supabase.co'
  if (upper.includes('DATABASE_URL') || upper.includes('POSTGRES')) {
    return 'postgres://user:password@localhost:5432/placeholder'
  }
  if (upper.includes('SUPABASE') && upper.includes('KEY')) {
    return 'placeholder.eyJhbGciOiJIUzI1NiJ9.placeholder'
  }
  if (upper.includes('SECRET') || upper.includes('KEY') || upper.includes('TOKEN')) {
    return 'placeholder-substitua-pelo-valor-real'
  }
  return 'placeholder'
}

// A etapa "backend" às vezes retorna "NOME=descrição/exemplo" em vez do nome
// puro (ex.: "NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co") —
// o formato exato do JSON não é validado contra um schema rígido, só o
// prompt pede "env_vars[]". Extrai só o identificador antes do "=".
function normalizeEnvVarKey(raw: string): string | null {
  const key = raw.split('=')[0]?.trim()
  if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null
  return key
}

export async function ensureProjectEnvVars(
  projectIdOrName: string,
  envVarNames: string[],
  accessToken: string,
): Promise<string[]> {
  const applied: string[] = []
  for (const raw of envVarNames) {
    const key = normalizeEnvVarKey(raw)
    if (!key) continue // ignora entradas mal formadas do LLM que nem um identificador válido têm
    try {
      await vercelFetch(`/v10/projects/${encodeURIComponent(projectIdOrName)}/env`, accessToken, {
        method: 'POST',
        body: {
          key,
          value: placeholderEnvValue(key),
          type: 'plain',
          target: ['production', 'preview', 'development'],
        },
      })
      applied.push(key)
    } catch (err) {
      // "já existe" nem sempre é 409: confirmado em produção que a Vercel
      // devolve 400 com code ENV_CONFLICT pra esse caso específico — checar
      // só o status HTTP deixava passar sem tratar e derrubava a publicação
      // inteira. Trata como sucesso (a variável já está lá, o que é
      // exatamente o que essa função quer) em vez de falhar.
      const isAlreadyExists = err instanceof VercelApiError
        && (err.status === 409 || /ENV_CONFLICT/.test(err.message))
      if (isAlreadyExists) { applied.push(key); continue }
      throw err
    }
  }
  return applied
}

export interface DeploymentResult {
  id:         string
  url:        string // <deployment>.vercel.app — disponível assim que o build termina
  readyState: string // QUEUED | BUILDING | READY | ERROR | CANCELED
}

export async function triggerDeployment(
  projectName: string,
  gitRepo: { owner: string; repo: string; branch: string },
  accessToken: string,
): Promise<DeploymentResult> {
  const data = await vercelFetch<{ id: string; url: string; readyState: string }>(
    '/v13/deployments?skipAutoDetectionConfirmation=1',
    accessToken,
    {
      method: 'POST',
      body: {
        name: projectName,
        target: 'production',
        gitSource: {
          type: 'github',
          repo: gitRepo.repo,
          ref:  gitRepo.branch,
          org:  gitRepo.owner,
        },
      },
    },
  )
  return { id: data.id, url: data.url, readyState: data.readyState }
}
