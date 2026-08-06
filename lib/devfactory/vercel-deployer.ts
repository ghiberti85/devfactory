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
    throw new Error(`Vercel API ${init.method ?? 'GET'} ${path} → ${res.status}: ${body}`)
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
  const data = await vercelFetch<VercelCreateProjectResponse>('/v11/projects', accessToken, {
    method: 'POST',
    body: {
      name,
      gitRepository: { repo: `${gitRepo.owner}/${gitRepo.repo}`, type: 'github' },
    },
  })
  return { id: data.id, name: data.name }
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
    '/v13/deployments',
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
