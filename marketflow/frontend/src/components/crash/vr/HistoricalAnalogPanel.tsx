import type { CSSProperties } from 'react'

export type HistoricalAnalogSummary = {
  analog_events: Array<{
    event_id: string
    pattern_type: string
    similarity_score: number
    summary?: string
  }>
  top_pattern_summary?: string
  context_note?: string
}

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

function eventLabel(eventId: string) {
  return `${eventId} Risk Event`
}

export default function HistoricalAnalogPanel({
  analogs,
}: {
  analogs?: HistoricalAnalogSummary | null
}) {
  return (
    <div style={panelStyle()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <div style={{ color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4 }}>
            Historical Analog Events
          </div>
          <div style={{ color: '#f8fafc', fontSize: '1.08rem', fontWeight: 800 }}>Current Structure Most Similar To</div>
          {analogs?.top_pattern_summary ? (
            <div style={{ color: '#cbd5e1', fontSize: '0.92rem', fontWeight: 700, marginTop: 8 }}>
              {analogs.top_pattern_summary}
            </div>
          ) : null}
        </div>
        <div style={{ color: '#64748b', fontSize: '0.8rem', maxWidth: 420, lineHeight: 1.55 }}>
          Historical VR-tagged events ranked by deterministic similarity to the current market structure.
        </div>
      </div>

      {analogs?.analog_events.length ? (
        <div style={{ display: 'grid', gap: 12 }}>
          {analogs.analog_events.slice(0, 3).map((event, index) => (
            <div
              key={event.event_id}
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 16,
                padding: '1rem',
                display: 'grid',
                gridTemplateColumns: '72px 1fr',
                gap: 12,
              }}
            >
              <div style={{ color: '#94a3b8', fontSize: '0.9rem', fontWeight: 800, paddingTop: 4 }}>{`${index + 1}.`}</div>
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <div style={{ color: '#f8fafc', fontSize: '1rem', fontWeight: 800 }}>{eventLabel(event.event_id)}</div>
                    <div style={{ color: '#cbd5e1', fontSize: '0.88rem' }}>{titleize(event.pattern_type)}</div>
                  </div>
                  <div style={{ color: '#e5e7eb', fontSize: '0.9rem', fontWeight: 800 }}>{`Similarity ${event.similarity_score}%`}</div>
                </div>
                {event.summary ? (
                  <div style={{ color: '#94a3b8', fontSize: '0.85rem', lineHeight: 1.55 }}>{event.summary}</div>
                ) : null}
                <div>
                  <a
                    href={`/vr-survival?tab=Playback&event=${event.event_id}`}
                    style={{
                      textDecoration: 'none',
                      color: '#cbd5e1',
                      fontSize: '0.84rem',
                      fontWeight: 700,
                      padding: '0.55rem 0.8rem',
                      borderRadius: 999,
                      border: '1px solid rgba(255,255,255,0.08)',
                      background: 'rgba(255,255,255,0.03)',
                      display: 'inline-flex',
                    }}
                  >
                    Open Playback
                  </a>
                </div>
              </div>
            </div>
          ))}

          {analogs.context_note ? (
            <div
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 16,
                padding: '1rem',
              }}
            >
              <div style={{ color: '#94a3b8', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                What This Means
              </div>
              <div style={{ color: '#cbd5e1', fontSize: '0.9rem', lineHeight: 1.6 }}>{analogs.context_note}</div>
            </div>
          ) : null}
        </div>
      ) : (
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
          <div>No strong historical analog detected.</div>
          <div style={{ marginTop: 8, fontSize: '0.82rem', color: '#64748b' }}>
            The current structure does not closely match the curated historical VR event set.
          </div>
        </div>
      )}
    </div>
  )
}
