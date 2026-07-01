/**
 * DevFactory — Human Gate UI
 * Painel de revisão e aprovação de cada etapa da pipeline.
 * Design: dark terminal, violet accent, monospace output.
 */

'use client'

import { useState, useEffect, useRef }  from 'react'
import { getPipelineStages }            from '@/lib/devfactory/types'
import type { SSEEvent, ProjectRun, StageRecord, QualityReport, PipelineStage } from '@/lib/devfactory/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface HumanGateProps {
  runId:        string
  onComplete?:  (run: ProjectRun) => void
}

type UIStatus =
  | 'idle'
  | 'running'
  | 'awaiting_human'
  | 'quality_review'
  | 'completed'
  | 'failed'
  | 'cancelled'

interface LiveEvent {
  id:        number
  type:      string
  stage?:    string
  payload:   unknown
  timestamp: Date
}

// ─── Stage metadata ───────────────────────────────────────────────────────────

const STAGE_META: Record<PipelineStage, { label: string; icon: string; color: string }> = {
  codebase_analysis: { label: 'Análise de Código', icon: '🔍', color: '#22d3ee' },
  planning:        { label: 'Planejamento',      icon: '📋', color: '#a78bfa' },
  docs_initial:    { label: 'Documentação',       icon: '📄', color: '#60a5fa' },
  design:          { label: 'Design',             icon: '🎨', color: '#f472b6' },
  backend:         { label: 'Backend',            icon: '⚙️',  color: '#34d399' },
  frontend:        { label: 'Frontend',           icon: '🖥️',  color: '#fbbf24' },
  tests:           { label: 'Testes',             icon: '🧪', color: '#fb923c' },
  quality_council: { label: 'Quality Council',   icon: '🛡️',  color: '#e879f9' },
  docs_final:      { label: 'Docs Final',         icon: '📚', color: '#94a3b8' },
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useRunStream(runId: string) {
  const [run,    setRun]    = useState<ProjectRun | null>(null)
  const [status, setStatus] = useState<UIStatus>('idle')
  const [events, setEvents] = useState<LiveEvent[]>([])
  const [pendingStage, setPendingStage] = useState<PipelineStage | null>(null)
  const counterRef = useRef(0)
  const sourceRef  = useRef<EventSource | null>(null)
  const statusRef  = useRef<UIStatus>('idle')

  useEffect(() => { statusRef.current = status }, [status])

  useEffect(() => {
    if (!runId) return

    const source = new EventSource(`/api/runs/${runId}/stream`)
    sourceRef.current = source

    const addEvent = (type: string, e: MessageEvent) => {
      const data = JSON.parse(e.data) as SSEEvent
      counterRef.current++
      setEvents(prev => [
        ...prev.slice(-99),   // manter últimos 100 eventos
        // data.timestamp sempre chega como string ISO — JSON não serializa Date
        { id: counterRef.current, type, stage: data.stage, payload: data.payload, timestamp: new Date(data.timestamp) },
      ])
      return data
    }

    source.addEventListener('run.snapshot',       e => { const d = addEvent('run.snapshot', e);       setRun(d.payload as ProjectRun) })
    source.addEventListener('run.started',        e => { addEvent('run.started', e);                  setStatus('running') })
    source.addEventListener('run.completed',      e => { addEvent('run.completed', e);                setStatus('completed'); setRun(prev => prev ? { ...prev, status: 'completed' } : null) })
    source.addEventListener('run.failed',         e => { addEvent('run.failed', e);                   setStatus('failed') })
    source.addEventListener('run.cancelled',      e => { addEvent('run.cancelled', e);                setStatus('cancelled') })
    source.addEventListener('stage.started',      e => { addEvent('stage.started', e);                setStatus('running'); setPendingStage(null) })
    source.addEventListener('stage.model_selected', e => addEvent('stage.model_selected', e))
    source.addEventListener('stage.executing',    e => addEvent('stage.executing', e))
    source.addEventListener('stage.self_critiquing', e => addEvent('stage.self_critiquing', e))
    source.addEventListener('stage.retry',        e => addEvent('stage.retry', e))
    source.addEventListener('stage.rejected',     e => addEvent('stage.rejected', e))
    source.addEventListener('agent.completed',    e => addEvent('agent.completed', e))
    source.addEventListener('quality_council.running', e => addEvent('quality_council.running', e))
    source.addEventListener('quality_council.dimension_running', e => addEvent('quality_council.dimension_running', e))

    source.addEventListener('stage.awaiting_human', e => {
      const d = addEvent('stage.awaiting_human', e)
      setStatus(d.stage === 'quality_council' ? 'quality_review' : 'awaiting_human')
      setPendingStage(d.stage as PipelineStage)
      // Atualiza snapshot do run via fetch
      fetch(`/api/runs/${runId}`).then(r => r.json()).then(setRun)
    })

    source.onerror = () => {
      if (statusRef.current !== 'completed' && statusRef.current !== 'cancelled') setStatus('failed')
    }

    return () => source.close()
  }, [runId])

  const sendDecision = async (decision: 'approved' | 'rejected' | 'edited', feedback?: string, editedOutput?: unknown) => {
    const token = pendingStage ? run?.stages[pendingStage]?.gateToken : undefined
    if (!token) {
      console.error('[HumanGate] gateToken ausente — não é possível resolver o gate.')
      return
    }
    await fetch(`/api/runs/${runId}/gate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ token, decision, feedback, editedOutput }),
    })
    setStatus('running')
    setPendingStage(null)
  }

  const cancel = async () => {
    await fetch(`/api/runs/${runId}`, { method: 'DELETE' })
    setStatus('cancelled')
  }

  return { run, status, events, pendingStage, sendDecision, cancel }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PipelineProgress({ run }: { run: ProjectRun | null }) {
  const order = getPipelineStages(run?.config.projectMode ?? 'greenfield')
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {order.map(stage => {
        const meta       = STAGE_META[stage]
        const stageData  = run?.stages[stage]
        const isCurrent  = run?.currentStage === stage
        const isApproved = stageData?.status === 'approved'
        const isRunning  = stageData?.status === 'running' || isCurrent
        const isPending  = !stageData

        return (
          <div
            key={stage}
            title={meta.label}
            style={{
              display:        'flex',
              alignItems:     'center',
              gap:            6,
              padding:        '6px 12px',
              borderRadius:   6,
              fontSize:       12,
              fontFamily:     'monospace',
              border:         `1px solid ${isApproved ? meta.color : isRunning ? meta.color : '#2d2d2d'}`,
              background:     isApproved ? `${meta.color}18` : isRunning ? `${meta.color}10` : '#1a1a1a',
              color:          isApproved ? meta.color : isRunning ? meta.color : '#555',
              opacity:        isPending ? 0.5 : 1,
              transition:     'all 0.3s',
              whiteSpace:     'nowrap',
            }}
          >
            <span>{meta.icon}</span>
            <span>{meta.label}</span>
            {isApproved && <span style={{ color: meta.color }}>✓</span>}
            {isRunning  && !isApproved && <span style={{ animation: 'pulse 1s infinite' }}>◉</span>}
          </div>
        )
      })}
    </div>
  )
}

function CostBadge({ run }: { run: ProjectRun | null }) {
  const cost = run?.totalCostUsd ?? 0
  return (
    <span style={{
      fontFamily: 'monospace',
      fontSize:   12,
      color:      cost === 0 ? '#34d399' : cost < 0.10 ? '#fbbf24' : '#f87171',
      background: '#1a1a1a',
      border:     '1px solid #2d2d2d',
      borderRadius: 4,
      padding:    '2px 8px',
    }}>
      ${cost.toFixed(6)} USD
    </span>
  )
}

function ModelBadge({ event }: { event: LiveEvent }) {
  const payload = event.payload as { model?: string; tier?: number } | null
  if (!payload?.model) return null
  return (
    <span style={{
      fontFamily:   'monospace',
      fontSize:     11,
      color:        '#a78bfa',
      background:   '#1a0a2e',
      border:       '1px solid #4c1d95',
      borderRadius: 4,
      padding:      '1px 6px',
    }}>
      {payload.model} • T{payload.tier}
    </span>
  )
}

function LiveLog({ events }: { events: LiveEvent[] }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events.length])

  const eventColors: Record<string, string> = {
    'run.started':           '#34d399',
    'run.completed':         '#34d399',
    'run.failed':            '#f87171',
    'stage.started':         '#a78bfa',
    'stage.model_selected':  '#60a5fa',
    'stage.awaiting_human':  '#fbbf24',
    'stage.retry':           '#fb923c',
    'stage.rejected':        '#f87171',
    'agent.completed':       '#94a3b8',
    'quality_council.dimension_running': '#e879f9',
  }

  return (
    <div style={{
      background:   '#0d0d0d',
      border:       '1px solid #1e1e1e',
      borderRadius: 8,
      padding:      12,
      height:       200,
      overflowY:    'auto',
      fontFamily:   'monospace',
      fontSize:     11,
      lineHeight:   1.7,
    }}>
      {events.map(ev => (
        <div key={ev.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span style={{ color: '#333', flexShrink: 0 }}>
            {ev.timestamp.toLocaleTimeString('pt-BR')}
          </span>
          <span style={{ color: eventColors[ev.type] ?? '#555', flexShrink: 0, minWidth: 220 }}>
            {ev.type}
          </span>
          {ev.stage && (
            <span style={{ color: '#666' }}>[{ev.stage}]</span>
          )}
          <ModelBadge event={ev} />
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}

function QualityCouncilPanel({
  reports,
  onApprove,
  onReject,
}: {
  reports:   QualityReport[]
  onApprove: () => void
  onReject:  (feedback: string) => void
}) {
  const [feedback, setFeedback] = useState('')
  const [showing, setShowing]   = useState(false)

  const verdictColor = (v: string) =>
    v === 'pass' ? '#34d399' : v === 'warn' ? '#fbbf24' : '#f87171'

  const allPassed = reports.every(r => r.verdict !== 'fail')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>
        Quality Council concluído — {reports.length} dimensões analisadas.
      </p>

      {!allPassed && (
        <p style={{ color: '#f87171', fontSize: 12, margin: 0 }}>
          ⚠ Uma ou mais dimensões falharam — revise antes de aprovar.
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {reports.map(r => (
          <div key={r.dimension} style={{
            background:   '#111',
            border:       `1px solid ${verdictColor(r.verdict)}33`,
            borderRadius: 6,
            padding:      10,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#e2e8f0', fontSize: 12, textTransform: 'capitalize' }}>
                {r.dimension.replace('_', ' ')}
              </span>
              <span style={{
                color:        verdictColor(r.verdict),
                fontFamily:   'monospace',
                fontSize:     11,
                background:   `${verdictColor(r.verdict)}15`,
                padding:      '1px 6px',
                borderRadius: 4,
              }}>
                {r.verdict.toUpperCase()} • {r.score}
              </span>
            </div>
            <div style={{ color: '#555', fontSize: 10, marginTop: 4 }}>{r.model}</div>
            {r.issues.length > 0 && (
              <div style={{ marginTop: 6 }}>
                {r.issues.slice(0, 2).map((issue, i) => (
                  <div key={i} style={{ color: '#94a3b8', fontSize: 10, marginTop: 2 }}>
                    ↳ {issue.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button onClick={onApprove} style={btnStyle('#34d399')}>
          ✓ Aprovar e continuar
        </button>
        <button onClick={() => setShowing(s => !s)} style={btnStyle('#f87171', true)}>
          ✗ Rejeitar
        </button>
      </div>

      {showing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            value={feedback}
            onChange={e => setFeedback(e.target.value)}
            placeholder="Descreva os problemas encontrados e o que deve ser corrigido..."
            style={textareaStyle}
          />
          <button
            onClick={() => { if (feedback.trim()) onReject(feedback) }}
            disabled={!feedback.trim()}
            style={btnStyle('#f87171')}
          >
            Enviar rejeição
          </button>
        </div>
      )}
    </div>
  )
}

function StageOutputPanel({
  stage,
  stageData,
  onApprove,
  onReject,
  onEdit,
}: {
  stage:     PipelineStage
  stageData: StageRecord | undefined
  onApprove: () => void
  onReject:  (feedback: string) => void
  onEdit:    (output: string, feedback?: string) => void
}) {
  const [feedback,   setFeedback]   = useState('')
  const [editMode,   setEditMode]   = useState(false)
  const [editValue,  setEditValue]  = useState('')
  const [activeTab,  setActiveTab]  = useState<'output' | 'critique' | 'model'>('output')

  const meta        = STAGE_META[stage]
  const lastIter    = stageData?.iterations?.at(-1)
  const outputStr   = JSON.stringify(lastIter?.agentOutput ?? {}, null, 2)
  const critiqueScore = lastIter?.selfCritique?.score ?? 0
  const model       = lastIter?.selectionResult?.model

  useEffect(() => {
    if (editMode) setEditValue(outputStr)
  }, [editMode, outputStr])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header da etapa */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 20 }}>{meta.icon}</span>
        <div>
          <h3 style={{ margin: 0, color: meta.color, fontSize: 14 }}>{meta.label}</h3>
          <span style={{ color: '#555', fontSize: 11, fontFamily: 'monospace' }}>
            Iteração {stageData?.iterations?.length ?? 1} •{' '}
            Auto-crítica: {(critiqueScore * 100).toFixed(0)}%
          </span>
        </div>

        {model && (
          <span style={{
            marginLeft:   'auto',
            fontFamily:   'monospace',
            fontSize:     11,
            color:        '#a78bfa',
            background:   '#1a0a2e',
            border:       '1px solid #4c1d95',
            borderRadius: 4,
            padding:      '2px 8px',
          }}>
            {model.displayName} • T{lastIter?.routerOutput?.tier}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #1e1e1e' }}>
        {(['output', 'critique', 'model'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              background:     'none',
              border:         'none',
              borderBottom:   activeTab === tab ? `2px solid ${meta.color}` : '2px solid transparent',
              color:          activeTab === tab ? meta.color : '#555',
              padding:        '6px 14px',
              fontSize:       12,
              fontFamily:     'monospace',
              cursor:         'pointer',
              textTransform:  'capitalize',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Conteúdo das tabs */}
      {activeTab === 'output' && (
        <div>
          {!editMode ? (
            <pre style={{
              background:   '#0d0d0d',
              border:       '1px solid #1e1e1e',
              borderRadius: 6,
              padding:      12,
              fontSize:     11,
              fontFamily:   'monospace',
              color:        '#e2e8f0',
              overflowX:    'auto',
              maxHeight:    240,
              overflowY:    'auto',
              margin:       0,
            }}>
              {outputStr}
            </pre>
          ) : (
            <textarea
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              style={{ ...textareaStyle, height: 240, fontFamily: 'monospace', fontSize: 11 }}
            />
          )}
        </div>
      )}

      {activeTab === 'critique' && lastIter?.selfCritique && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{
            display:    'flex',
            alignItems: 'center',
            gap:        8,
            padding:    8,
            background: '#0d0d0d',
            borderRadius: 6,
          }}>
            <div style={{
              width:        40,
              height:       40,
              borderRadius: '50%',
              border:       `3px solid ${critiqueScore >= 0.7 ? '#34d399' : '#f87171'}`,
              display:      'flex',
              alignItems:   'center',
              justifyContent: 'center',
              color:        critiqueScore >= 0.7 ? '#34d399' : '#f87171',
              fontFamily:   'monospace',
              fontSize:     12,
              fontWeight:   700,
            }}>
              {(critiqueScore * 100).toFixed(0)}
            </div>
            <div>
              <div style={{ color: '#e2e8f0', fontSize: 12 }}>Score de auto-crítica</div>
              <div style={{ color: '#555', fontSize: 11 }}>
                {critiqueScore >= 0.7 ? '✓ Passou o threshold' : '✗ Abaixo do threshold (0.70)'}
              </div>
            </div>
          </div>

          {lastIter.selfCritique.issues.map((issue, i) => (
            <div key={i} style={{
              padding:      8,
              background:   '#0d0d0d',
              borderLeft:   `3px solid ${issue.severity === 'high' ? '#f87171' : issue.severity === 'medium' ? '#fbbf24' : '#94a3b8'}`,
              borderRadius: '0 4px 4px 0',
              fontSize:     12,
              color:        '#94a3b8',
            }}>
              <span style={{ textTransform: 'capitalize', fontWeight: 600 }}>{issue.severity}</span>
              {issue.location && <span style={{ color: '#555' }}> @ {issue.location}</span>}
              <div style={{ marginTop: 2 }}>{issue.message}</div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'model' && lastIter && (
        <div style={{
          display:      'grid',
          gridTemplateColumns: '1fr 1fr',
          gap:          8,
          padding:      10,
          background:   '#0d0d0d',
          borderRadius: 6,
          fontSize:     12,
          fontFamily:   'monospace',
        }}>
          {[
            ['Modelo',    lastIter.selectionResult?.model?.displayName],
            ['Provider',  lastIter.selectionResult?.model?.provider],
            ['Tier',      lastIter.routerOutput?.tier],
            ['Confiança', `${((lastIter.routerOutput?.confidence ?? 0) * 100).toFixed(0)}%`],
            ['Latência',  lastIter.completedAt
              ? `${new Date(lastIter.completedAt).getTime() - new Date(lastIter.startedAt).getTime()}ms`
              : '–'],
            ['Custo est.', `$${(lastIter.selectionResult?.estimatedCostUsd ?? 0).toFixed(6)}`],
          ].map(([label, value]) => (
            <div key={label as string}>
              <div style={{ color: '#555', fontSize: 10 }}>{label}</div>
              <div style={{ color: '#e2e8f0' }}>{value ?? '–'}</div>
            </div>
          ))}
        </div>
      )}

      {/* Feedback + ações */}
      <textarea
        value={feedback}
        onChange={e => setFeedback(e.target.value)}
        placeholder="Feedback opcional (será injetado como contexto na próxima iteração)..."
        style={{ ...textareaStyle, height: 72 }}
      />

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          onClick={() => {
            if (editMode) {
              try {
                const parsed = JSON.parse(editValue)
                onEdit(parsed, feedback || undefined)
              } catch {
                onEdit(editValue, feedback || undefined)
              }
              setEditMode(false)
            } else {
              onApprove()
            }
          }}
          style={btnStyle('#34d399')}
        >
          ✓ {editMode ? 'Salvar edição' : 'Aprovar'}
        </button>

        <button
          onClick={() => setEditMode(e => !e)}
          style={btnStyle('#60a5fa', true)}
        >
          ✏️ {editMode ? 'Cancelar edição' : 'Editar output'}
        </button>

        <button
          onClick={() => { if (feedback.trim()) onReject(feedback) }}
          disabled={!feedback.trim()}
          style={btnStyle('#f87171', true)}
        >
          ✗ Rejeitar
        </button>
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function HumanGate({ runId, onComplete }: HumanGateProps) {
  const { run, status, events, pendingStage, sendDecision, cancel } = useRunStream(runId)
  const completedRef = useRef(false)

  useEffect(() => {
    if (status === 'completed' && run && onComplete && !completedRef.current) {
      completedRef.current = true
      onComplete(run)
    }
  }, [status, run, onComplete])

  const qualityReports = run?.qualityReports ?? []

  const statusLabel: Record<UIStatus, string> = {
    idle:           'Aguardando início...',
    running:        'Executando pipeline...',
    awaiting_human: 'Aguardando revisão humana',
    quality_review: 'Quality Council — revisão',
    completed:      'Pipeline concluída ✓',
    failed:         'Pipeline falhou ✗',
    cancelled:      'Pipeline cancelada',
  }

  const statusColor: Record<UIStatus, string> = {
    idle:           '#555',
    running:        '#60a5fa',
    awaiting_human: '#fbbf24',
    quality_review: '#e879f9',
    completed:      '#34d399',
    failed:         '#f87171',
    cancelled:      '#94a3b8',
  }

  return (
    <div style={{
      background:   '#0a0a0a',
      color:        '#e2e8f0',
      minHeight:    '100vh',
      fontFamily:   "'Inter', -apple-system, sans-serif",
      padding:      24,
    }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        button:disabled { opacity: 0.4; cursor: not-allowed; }
        textarea:focus { outline: none; border-color: #a78bfa; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: #0d0d0d; }
        ::-webkit-scrollbar-thumb { background: #2d2d2d; border-radius: 2px; }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, letterSpacing: -0.5 }}>
            DevFactory
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <span style={{
              width:        8,
              height:       8,
              borderRadius: '50%',
              background:   statusColor[status],
              display:      'inline-block',
              animation:    status === 'running' ? 'pulse 1.5s infinite' : 'none',
            }} />
            <span style={{ color: statusColor[status], fontSize: 13 }}>
              {statusLabel[status]}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <CostBadge run={run} />
          {status === 'running' && (
            <button onClick={cancel} style={{ ...btnStyle('#f87171', true), padding: '4px 10px', fontSize: 11 }}>
              Cancelar
            </button>
          )}
        </div>
      </div>

      {/* Pipeline Progress */}
      <div style={{ marginBottom: 20 }}>
        <PipelineProgress run={run} />
      </div>

      {/* Gate de revisão humana */}
      {(status === 'awaiting_human' || status === 'quality_review') && pendingStage && (
        <div style={{
          background:   '#111',
          border:       '1px solid #fbbf2433',
          borderRadius: 10,
          padding:      20,
          marginBottom: 20,
        }}>
          <div style={{
            color:        '#fbbf24',
            fontSize:     11,
            fontFamily:   'monospace',
            marginBottom: 12,
            letterSpacing: 1,
          }}>
            ◉ AGUARDANDO REVISÃO HUMANA
          </div>

          {status === 'quality_review' && qualityReports.length > 0 ? (
            <QualityCouncilPanel
              reports={qualityReports}
              onApprove={() => sendDecision('approved')}
              onReject={fb => sendDecision('rejected', fb)}
            />
          ) : (
            <StageOutputPanel
              stage={pendingStage}
              stageData={run?.stages[pendingStage]}
              onApprove={() => sendDecision('approved')}
              onReject={fb => sendDecision('rejected', fb)}
              onEdit={(output, fb) => sendDecision('edited', fb, output)}
            />
          )}
        </div>
      )}

      {/* Log em tempo real */}
      <div>
        <div style={{ color: '#555', fontSize: 11, fontFamily: 'monospace', marginBottom: 8 }}>
          LOG DE EVENTOS ({events.length})
        </div>
        <LiveLog events={events} />
      </div>

      {/* Completed */}
      {status === 'completed' && run && (
        <div style={{
          marginTop:    16,
          padding:      16,
          background:   '#0a1a12',
          border:       '1px solid #34d39933',
          borderRadius: 10,
          display:      'flex',
          alignItems:   'center',
          gap:          12,
        }}>
          <span style={{ fontSize: 24 }}>✅</span>
          <div>
            <div style={{ color: '#34d399', fontWeight: 600 }}>Pipeline concluída com sucesso</div>
            <div style={{ color: '#555', fontSize: 12, fontFamily: 'monospace', marginTop: 2 }}>
              {getPipelineStages(run.config.projectMode).length} etapas •  custo total: ${run.totalCostUsd.toFixed(6)} USD
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Style helpers ────────────────────────────────────────────────────────────

function btnStyle(color: string, ghost = false): React.CSSProperties {
  return {
    background:   ghost ? 'transparent' : `${color}18`,
    border:       `1px solid ${color}44`,
    color,
    borderRadius: 6,
    padding:      '7px 16px',
    fontSize:     12,
    fontFamily:   'monospace',
    cursor:       'pointer',
    transition:   'all 0.15s',
  }
}

const textareaStyle: React.CSSProperties = {
  background:   '#111',
  border:       '1px solid #2d2d2d',
  borderRadius: 6,
  color:        '#e2e8f0',
  padding:      10,
  fontSize:     12,
  resize:       'vertical',
  width:        '100%',
  boxSizing:    'border-box',
  fontFamily:   "'Inter', sans-serif",
}
