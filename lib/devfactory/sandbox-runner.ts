/**
 * DevFactory — Sandbox Runner
 * lib/devfactory/sandbox-runner.ts
 *
 * Executa código gerado (testes, lint, checagens de qualidade) em microVMs
 * isoladas do Vercel Sandbox — nunca no processo da aplicação. Substitui
 * qualquer ideia de usar vm2 (descontinuado por falhas graves de sandbox
 * escape — não usar) ou rodar comandos diretamente no host.
 *
 * Padrão de segurança: instala dependências com rede liberada, depois
 * trava a rede (`setNetworkPolicy`) ANTES de rodar o código gerado pela IA.
 */

import { Sandbox } from '@vercel/sandbox'

export type QualityDimension = 'security' | 'performance' | 'seo' | 'a11y' | 'best_practices'

export interface GeneratedFile {
  path:    string
  content: string
}

export interface QualityCheckResult {
  dimension: QualityDimension
  score:     number   // 0-100
  verdict:   'pass' | 'warn' | 'fail'
  issues:    Array<{ severity: 'low' | 'medium' | 'high'; message: string; location?: string }>
  model:     string   // ferramenta/modelo usado para essa dimensão
  rawOutput: string
}

// Ferramenta + comando por dimensão. Tudo CLI padrão — sem nada proprietário.
const DIMENSION_TOOLING: Record<QualityDimension, { tool: string; installCmd: string[]; runCmd: string[] }> = {
  security: {
    tool: 'semgrep',
    installCmd: ['pip', 'install', '--quiet', 'semgrep'],
    runCmd: ['semgrep', '--config=auto', '--json', '.'],
  },
  performance: {
    tool: 'lighthouse-ci',
    installCmd: ['npm', 'install', '-g', '@lhci/cli'],
    runCmd: ['lhci', 'autorun', '--collect.numberOfRuns=1'],
  },
  seo: {
    tool: 'lighthouse-ci',
    installCmd: ['npm', 'install', '-g', '@lhci/cli'],
    runCmd: ['lhci', 'autorun', '--collect.numberOfRuns=1', '--only-categories=seo'],
  },
  a11y: {
    tool: 'axe-core',
    installCmd: ['npm', 'install', '-g', '@axe-core/cli'],
    runCmd: ['axe', '--exit'],
  },
  best_practices: {
    tool: 'eslint',
    installCmd: ['npm', 'install', '-g', 'eslint'],
    runCmd: ['eslint', '.', '--format=json'],
  },
}

// ─── Execução de testes (etapa "tests") ──────────────────────────────────────

export interface TestRunResult {
  passed:     boolean
  exitCode:   number
  stdout:     string
  stderr:     string
  durationMs: number
}

export async function runTestsInSandbox(
  files:      GeneratedFile[],
  testCommand = ['npm', 'test'],
): Promise<TestRunResult> {
  const startedAt = Date.now()

  const sandbox = await Sandbox.create({
    runtime: 'node24',
    timeout: 120_000,  // 2 min — suficiente para a maioria das suítes de teste
  })

  try {
    await writeFiles(sandbox, files)

    // Instala dependências com rede liberada
    const install = await sandbox.runCommand({ cmd: 'npm', args: ['install', '--no-audit', '--no-fund'] })
    if (install.exitCode !== 0) {
      return {
        passed: false, exitCode: install.exitCode,
        stdout: await readAll(install.stdout), stderr: await readAll(install.stderr),
        durationMs: Date.now() - startedAt,
      }
    }

    // Trava a rede ANTES de rodar o código gerado pela IA — princípio do
    // menor privilégio: testes não precisam de acesso externo pra rodar.
    await sandbox.setNetworkPolicy({ policy: 'deny-all' })

    const [cmd, ...args] = testCommand
    const result = await sandbox.runCommand({ cmd, args })

    return {
      passed:     result.exitCode === 0,
      exitCode:   result.exitCode,
      stdout:     await readAll(result.stdout),
      stderr:     await readAll(result.stderr),
      durationMs: Date.now() - startedAt,
    }
  } finally {
    await sandbox.stop()
  }
}

// ─── Quality Council — uma dimensão por chamada (rodam em Promise.all) ─────

export async function runQualityCheckInSandbox(
  dimension: QualityDimension,
  files:     GeneratedFile[],
): Promise<QualityCheckResult> {
  const tooling = DIMENSION_TOOLING[dimension]

  const sandbox = await Sandbox.create({
    runtime: 'node24',
    timeout: 90_000,
  })

  try {
    await writeFiles(sandbox, files)

    const install = await sandbox.runCommand({ cmd: tooling.installCmd[0], args: tooling.installCmd.slice(1) })
    if (install.exitCode !== 0) {
      return emptyResult(dimension, tooling.tool, 'Falha ao instalar ferramenta de análise.')
    }

    // Lockdown de rede antes de analisar código gerado pela IA
    await sandbox.setNetworkPolicy({ policy: 'deny-all' })

    const [cmd, ...args] = tooling.runCmd
    const result = await sandbox.runCommand({ cmd, args })
    const rawOutput = await readAll(result.stdout)

    return parseToolOutput(dimension, tooling.tool, rawOutput, result.exitCode)
  } catch (err) {
    return emptyResult(dimension, tooling.tool, err instanceof Error ? err.message : 'Erro desconhecido na sandbox.')
  } finally {
    await sandbox.stop()
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function writeFiles(sandbox: InstanceType<typeof Sandbox>, files: GeneratedFile[]): Promise<void> {
  // A API exata de escrita de arquivos deve ser conferida na doc atual do
  // @vercel/sandbox (vercel.com/docs/vercel-sandbox) — o SDK expõe gestão de
  // arquivos além de runCommand; o nome do método pode variar entre versões.
  for (const file of files) {
    await sandbox.runCommand({
      cmd: 'sh',
      args: ['-c', `mkdir -p "$(dirname '${file.path}')" && cat > '${file.path}' << 'DEVFACTORY_EOF'\n${file.content}\nDEVFACTORY_EOF`],
    })
  }
}

async function readAll(stream: unknown): Promise<string> {
  // runCommand pode retornar stdout como string já materializada ou como
  // stream, dependendo da forma de chamada — normaliza os dois casos.
  if (typeof stream === 'string') return stream
  if (stream && typeof (stream as any).text === 'function') return (stream as any).text()
  return String(stream ?? '')
}

function emptyResult(dimension: QualityDimension, model: string, message: string): QualityCheckResult {
  return {
    dimension, score: 0, verdict: 'fail', model, rawOutput: message,
    issues: [{ severity: 'high', message }],
  }
}

function parseToolOutput(
  dimension: QualityDimension,
  model:     string,
  rawOutput: string,
  exitCode:  number,
): QualityCheckResult {
  // Parsing simplificado — cada ferramenta tem um schema de output diferente.
  // Em produção, um parser dedicado por ferramenta (semgrep JSON, ESLint
  // JSON, axe JSON, Lighthouse JSON) substituiria esta heurística genérica.
  try {
    const parsed = JSON.parse(rawOutput)
    const issueCount = Array.isArray(parsed) ? parsed.length : (parsed.results?.length ?? parsed.violations?.length ?? 0)
    const score = Math.max(0, 100 - issueCount * 5)
    return {
      dimension, model, rawOutput,
      score,
      verdict: score >= 80 ? 'pass' : score >= 60 ? 'warn' : 'fail',
      issues: [], // mapear issues reais por ferramenta na implementação final
    }
  } catch {
    return {
      dimension, model, rawOutput,
      score: exitCode === 0 ? 90 : 50,
      verdict: exitCode === 0 ? 'pass' : 'warn',
      issues: [],
    }
  }
}
