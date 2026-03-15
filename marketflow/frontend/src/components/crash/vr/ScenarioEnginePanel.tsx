import type { CSSProperties } from 'react'
import type { HistoricalAnalogSummary } from './HistoricalAnalogPanel'

export type ScenarioEngineScenario = {
  scenario_id: string
  scenario_name: string
  description: string
  posture_guidance: string[]
}

export type ScenarioEnginePanelData = {
  scenarios: ScenarioEngineScenario[]
  suggested_posture?: string[]
  historical_analogs?: HistoricalAnalogSummary
}

export type ScenarioTypeLabel = 'Downside Risk' | 'Neutral / Monitoring' | 'Recovery Attempt'

function panelStyle(extra?: CSSProperties): CSSProperties {
  return {
    background: 'linear-gradient(180deg, rgba(8,12,22,0.94), rgba(9,11,17,0.98))',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 20,
    padding: '1.35rem 1.45rem',
    boxShadow: '0 18px 40px rgba(0,0,0,0.18)',
    ...extra,
  }
}

function titleize(value: string) {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function classifyScenarioType(scenario: ScenarioEngineScenario): ScenarioTypeLabel {
  const key = `${scenario.scenario_id} ${scenario.scenario_name} ${scenario.description}`.toLowerCase()

  if (
    key.includes('breakdown') ||
    key.includes('lower_low') ||
    key.includes('decline') ||
    key.includes('crash') ||
    key.includes('bear') ||
    key.includes('extended_correction')
  ) {
    return 'Downside Risk'
  }

  if (
    key.includes('recovery') ||
    key.includes('rally') ||
    key.includes('breakout') ||
    key.includes('bottom') ||
    key.includes('stabilization')
  ) {
    return 'Recovery Attempt'
  }

  return 'Neutral / Monitoring'
}

function typeTone(type: ScenarioTypeLabel): CSSProperties {
  if (type === 'Downside Risk') {
    return {
      border: '1px solid rgba(239,68,68,0.24)',
      background: 'rgba(239,68,68,0.08)',
      color: '#fca5a5',
    }
  }
  if (type === 'Recovery Attempt') {
    return {
      border: '1px solid rgba(34,197,94,0.22)',
      background: 'rgba(34,197,94,0.08)',
      color: '#86efac',
    }
  }
  return {
    border: '1px solid rgba(96,165,250,0.22)',
    background: 'rgba(96,165,250,0.08)',
    color: '#93c5fd',
  }
}

function buildScenarioPostureSummary(scenarios: ScenarioEngineScenario[], suggestedPosture?: string[]) {
  if (!scenarios.length) return undefined

  const scenarioTypes = new Set(scenarios.map(classifyScenarioType))
  const posture = suggestedPosture?.slice(0, 2) ?? []
  const parts: string[] = []

  if (scenarioTypes.has('Neutral / Monitoring')) {
    parts.push('Maintain monitoring posture while direction remains unresolved.')
  }
  if (scenarioTypes.has('Downside Risk')) {
    parts.push('Keep downside protection in focus until support proves durable.')
  }
  if (scenarioTypes.has('Recovery Attempt')) {
    parts.push('Treat rebounds as controlled recovery attempts until persistence improves.')
  }

  if (posture.length) {
    parts.push(`Current posture emphasis: ${posture.join(', ')}.`)
  }

  return parts.slice(0, 2).join(' ')
}

function buildMonitoringNote(scenarios: ScenarioEngineScenario[]) {
  if (!scenarios.length) return undefined

  const ids = scenarios.map((scenario) => scenario.scenario_id)
  const notes: string[] = []

  if (ids.some((id) => id.includes('breakdown') || id.includes('lower_low') || id.includes('crash'))) {
    notes.push('Watch whether recent support fails.')
  }
  if (ids.some((id) => id.includes('range') || id.includes('sideways') || id.includes('extended_range'))) {
    notes.push('Watch whether the current range resolves above resistance or below support.')
  }
  if (ids.some((id) => id.includes('recovery') || id.includes('rally') || id.includes('breakout') || id.includes('bottom'))) {
    notes.push('Watch rebound persistence over the next few sessions.')
  }

  return notes.slice(0, 2).join(' ')
}

export default function ScenarioEnginePanel({
  scenarios,
  suggested_posture,
  historical_analogs,
}: ScenarioEnginePanelData) {
  const displayedScenarios = scenarios.slice(0, 3)
  const primaryAnalogEvent = historical_analogs?.analog_events[0]?.event_id
  const postureSummary = buildScenarioPostureSummary(displayedScenarios, suggested_posture)
  const monitoringNote = buildMonitoringNote(displayedScenarios)

  return (
    <div style={panelStyle()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <div style={{ color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>
            Scenario Engine
          </div>
          <div style={{ color: '#f8fafc', fontSize: '1.08rem', fontWeight: 800 }}>Plausible Market Paths</div>
        </div>
        <div style={{ color: '#64748b', fontSize: '0.8rem', maxWidth: 460, lineHeight: 1.55 }}>
          These branches show what to monitor next without implying a single exact outcome.
        </div>
      </div>

      {!displayedScenarios.length ? (
        <div
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 16,
            padding: '1rem',
            color: '#94a3b8',
            fontSize: '0.9rem',
          }}
        >
          <div>No scenario branches available yet.</div>
          <div style={{ marginTop: 8, fontSize: '0.82rem', color: '#64748b' }}>
            Scenario mapping is not available for the current state.
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {postureSummary ? (
            <div
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 16,
                padding: '1rem',
              }}
            >
              <div style={{ color: '#94a3b8', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                Scenario-Based Posture
              </div>
              <div style={{ color: '#cbd5e1', fontSize: '0.9rem', lineHeight: 1.6 }}>{postureSummary}</div>
            </div>
          ) : null}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            {displayedScenarios.map((scenario) => {
              const scenarioType = classifyScenarioType(scenario)
              const tone = typeTone(scenarioType)

              return (
                <div
                  key={scenario.scenario_id}
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: tone.border,
                    borderRadius: 16,
                    padding: '1rem',
                    display: 'grid',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    <div style={{ color: '#f8fafc', fontSize: '1rem', fontWeight: 800 }}>{scenario.scenario_name || titleize(scenario.scenario_id)}</div>
                    <div
                      style={{
                        ...tone,
                        padding: '0.35rem 0.6rem',
                        borderRadius: 999,
                        fontSize: '0.76rem',
                        fontWeight: 800,
                      }}
                    >
                      {scenarioType}
                    </div>
                  </div>

                  <div style={{ color: '#cbd5e1', fontSize: '0.9rem', lineHeight: 1.55 }}>{scenario.description}</div>

                  <div>
                    <div style={{ color: '#94a3b8', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                      Posture
                    </div>
                    <div style={{ display: 'grid', gap: 6 }}>
                      {scenario.posture_guidance.map((item) => (
                        <div key={item} style={{ color: '#e5e7eb', fontSize: '0.86rem', lineHeight: 1.5 }}>
                          {`- ${titleize(item)}`}
                        </div>
                      ))}
                    </div>
                  </div>

                  {primaryAnalogEvent ? (
                    <div>
                      <a
                        href={`/vr-survival?tab=Playback&event=${primaryAnalogEvent}`}
                        style={{
                          textDecoration: 'none',
                          color: '#cbd5e1',
                          fontSize: '0.82rem',
                          fontWeight: 700,
                          padding: '0.5rem 0.75rem',
                          borderRadius: 999,
                          border: '1px solid rgba(255,255,255,0.08)',
                          background: 'rgba(255,255,255,0.03)',
                          display: 'inline-flex',
                        }}
                      >
                        Open Related Historical Analog
                      </a>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>

          {monitoringNote ? (
            <div
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 16,
                padding: '1rem',
              }}
            >
              <div style={{ color: '#94a3b8', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                What To Watch Next
              </div>
              <div style={{ color: '#cbd5e1', fontSize: '0.9rem', lineHeight: 1.6 }}>{monitoringNote}</div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
