/**
 * GET /api/runs/[runId]/download
 *
 * Baixa os arquivos gerados (backend + frontend) como .zip. É a única forma
 * hoje de "ver o resultado" de um run — não existe deploy automático ainda
 * (isso é a Fase 4, ainda não implementada), então sem isso o usuário
 * aprovava a pipeline inteira e não tinha nenhum jeito de acessar o que foi
 * gerado além de consultar o Postgres direto.
 */

import { NextRequest, NextResponse } from 'next/server'
import JSZip from 'jszip'
import { getSessionUser, unauthorizedResponse } from '@/lib/devfactory/auth'
import { createSupabaseServerClient } from '@/lib/devfactory/supabase'

interface GeneratedFile {
  path:    string
  content: string
}

function extractFiles(finalOutput: unknown): GeneratedFile[] {
  if (!finalOutput || typeof finalOutput !== 'object') return []
  const files = (finalOutput as { files?: unknown }).files
  if (!Array.isArray(files)) return []
  return files.filter(
    (f): f is GeneratedFile => typeof f?.path === 'string' && typeof f?.content === 'string',
  )
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const user = await getSessionUser(req)
  if (!user) return unauthorizedResponse()

  const { runId } = await params
  const supabase = createSupabaseServerClient(req)

  const { data: run, error } = await supabase
    .from('pipeline_runs')
    .select('id, user_id, stage_outputs(stage, final_output)')
    .eq('id', runId)
    .single()

  if (error || !run) {
    return NextResponse.json({ error: 'Run não encontrado.' }, { status: 404 })
  }
  if (run.user_id !== user.id) {
    return NextResponse.json({ error: 'Sem acesso.' }, { status: 403 })
  }

  const stageOutputs = (run.stage_outputs ?? []) as { stage: string; final_output: unknown }[]
  const backend = stageOutputs.find(so => so.stage === 'backend')
  const frontend = stageOutputs.find(so => so.stage === 'frontend')
  const allFiles = [
    ...extractFiles(backend?.final_output),
    ...extractFiles(frontend?.final_output),
  ]

  if (allFiles.length === 0) {
    return NextResponse.json(
      { error: 'Nenhum arquivo gerado ainda — as etapas backend/frontend precisam estar aprovadas.' },
      { status: 409 },
    )
  }

  const zip = new JSZip()
  for (const file of allFiles) {
    zip.file(file.path, file.content)
  }
  const buffer = await zip.generateAsync({ type: 'uint8array' })
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer

  return new NextResponse(arrayBuffer, {
    headers: {
      'Content-Type':        'application/zip',
      'Content-Disposition': `attachment; filename="devfactory-${runId.slice(0, 8)}.zip"`,
    },
  })
}
