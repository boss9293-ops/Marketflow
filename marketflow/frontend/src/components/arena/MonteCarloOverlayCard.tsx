import type { ArenaOverlayDisplayModel } from '../../lib/arena/overlay/buildArenaOverlayDisplayModel'

function formatScore(value: number) {
  return `${Math.round(value)}`
}

function formatOdds(value: number) {
  return `${Math.round(value * 100)}%`
}

function scoreRow(label: string, value: string, detail?: string) {
  return (
    <div
      key={label}
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.2fr) auto',
        gap: 12,
        alignItems: 'start',
        padding: '0.65rem 0',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <div>
        <div style={{ color: '#e5e7eb', fontSize: '0.84rem', fontWeight: 700 }}>{label}</div>
        {detail ? <div style={{ color: '#94a3b8', fontSize: '0.76rem', marginTop: 4 }}>{detail}</div> : null}
      </div>
      <div style={{ color: '#f8fafc', fontSize: '0.92rem', fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  )
}

export default function MonteCarloOverlayCard({
  model,
}: {
  model: ArenaOverlayDisplayModel
}) {
  if (!model.mcOverlay) {
    return (
      <div
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 18,
          padding: '1rem 1.05rem',
        }}
      >
        <div style={{ color: '#f8fafc', fontSize: '1rem', fontWeight: 800 }}>Monte Carlo Overlay</div>
        <div style={{ color: '#cbd5e1', fontSize: '0.84rem', lineHeight: 1.6, marginTop: 10 }}>
          Monte Carlo overlay unavailable. The rule-based warning layer remains active and unchanged.
        </div>
        <div style={{ color: '#94a3b8', fontSize: '0.77rem', lineHeight: 1.6, marginTop: 12 }}>
          Monte Carlo overlay summarizes how similar synthetic stress paths behaved.
          <br />
          Overlay is interpretive, not executable.
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 18,
        padding: '1rem 1.05rem',
      }}
    >
      <div style={{ color: '#f8fafc', fontSize: '1rem', fontWeight: 800 }}>Monte Carlo Overlay</div>
      <div style={{ color: '#f8fafc', fontSize: '0.92rem', fontWeight: 700, lineHeight: 1.5, marginTop: 10 }}>
        {model.humanReadable.summaryLine}
      </div>
      <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
        {model.humanReadable.detailLines.map((line) => (
          <div key={line} style={{ color: '#cbd5e1', fontSize: '0.8rem', lineHeight: 1.55 }}>
            {line}
          </div>
        ))}
      </div>
      <div style={{ color: '#94a3b8', fontSize: '0.77rem', lineHeight: 1.5, marginTop: 10 }}>
        {model.mcOverlay.overlayReason}
      </div>
      <div style={{ marginTop: 14 }}>
        {scoreRow('Crash Risk', formatScore(model.mcOverlay.mcCrashRiskScore), 'Continuation / further damage risk')}
        {scoreRow(
          'Agreement Score',
          formatScore(model.mcOverlay.mcAgreementScore),
          'Internal alignment across rule warning, MC scenario, and regime context'
        )}
        {scoreRow(
          'Conflict Score',
          formatScore(model.mcOverlay.mcConflictScore),
          'Explicit contradiction / uncertainty penalty across the interpretation stack'
        )}
        {scoreRow('Interpretation State', model.mcOverlay.mcInterpretationState.split('_').join(' '))}
        {scoreRow('Current Regime', model.mcOverlay.mcCurrentRegime, 'Monte Carlo structural context inferred from similar paths')}
        {scoreRow('Regime Confidence', formatScore(model.mcOverlay.mcRegimeConfidence), 'How strongly similar paths agree on the current regime')}
        {scoreRow('V-Shape Odds (20d)', formatScore(model.mcOverlay.mcVShapeOdds20d), 'Strong rebound odds in the next 20 trading days')}
        {scoreRow('Recovery Odds (20d)', formatScore(model.mcOverlay.mcRecoveryOdds20d), 'Broader stabilization and recovery odds')}
        {scoreRow(
          'Recovery Transition Odds',
          formatScore(model.mcOverlay.mcRecoveryTransitionOdds),
          'Probability of transitioning into RECOVERY soon across similar paths'
        )}
        {scoreRow(
          'Panic Persistence Risk',
          formatScore(model.mcOverlay.mcPanicPersistenceRisk),
          'Probability that PANIC persists or reappears across similar paths'
        )}
        {scoreRow('Cash Stress Risk', formatScore(model.mcOverlay.mcCashStressRisk), 'Cash-floor / cycle-cap stress on constrained strategies')}
        {scoreRow('False Recovery Risk', formatScore(model.mcOverlay.mcFalseRecoveryRisk), 'Dead-cat / false-bottom risk')}
        {scoreRow('Warning Confidence', formatScore(model.mcOverlay.mcWarningConfidence), 'How informative similar warning states were')}
        {scoreRow(
          'Trust Score',
          formatScore(model.mcOverlay.mcTrustScore),
          'Historically calibrated reliability for the current interpretation state'
        )}
        {scoreRow('Confidence Bucket', model.mcOverlay.mcCalibrationBucket.split('_').join(' '))}
        {scoreRow('Dominant MC Scenario', model.mcOverlay.dominantMcScenario)}
      </div>
      <div style={{ marginTop: 14 }}>
        <div style={{ color: '#e5e7eb', fontSize: '0.84rem', fontWeight: 700, marginBottom: 8 }}>
          Next-State Odds
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))',
            gap: 8,
          }}
        >
          {(
            ['NORMAL', 'SELLOFF', 'PANIC', 'BOTTOMING', 'RECOVERY'] as const
          ).map((state) => (
            <div
              key={state}
              style={{
                background: 'rgba(255,255,255,0.025)',
                border: '1px solid rgba(255,255,255,0.05)',
                borderRadius: 12,
                padding: '0.7rem 0.75rem',
              }}
            >
              <div style={{ color: '#94a3b8', fontSize: '0.72rem', letterSpacing: '0.04em' }}>{state}</div>
              <div
                style={{
                  color: '#f8fafc',
                  fontSize: '0.9rem',
                  fontWeight: 800,
                  marginTop: 6,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatOdds(model.mcOverlay.mcNextStateOdds[state])}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ color: '#94a3b8', fontSize: '0.77rem', lineHeight: 1.6, marginTop: 12 }}>
        Monte Carlo overlay summarizes how similar synthetic stress paths behaved.
        <br />
        Overlay is interpretive, not executable.
      </div>
    </div>
  )
}
