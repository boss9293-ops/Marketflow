import type { ArenaOverlayDisplayModel } from '../../lib/arena/overlay/buildArenaOverlayDisplayModel'

function formatScore(value: number | null | undefined) {
  return value == null || Number.isNaN(value) ? 'n/a' : `${Math.round(value)}`
}

function tile(label: string, text: string, detail?: string) {
  return (
    <div
      key={label}
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 14,
        padding: '0.8rem 0.9rem',
        minHeight: 88,
      }}
    >
      <div
        style={{
          fontSize: '0.7rem',
          color: '#94a3b8',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        {label}
      </div>
      <div style={{ color: '#f8fafc', fontSize: '0.96rem', fontWeight: 800, marginTop: 8 }}>{text}</div>
      {detail ? <div style={{ color: '#94a3b8', fontSize: '0.78rem', marginTop: 8, lineHeight: 1.45 }}>{detail}</div> : null}
    </div>
  )
}

export default function OverlayScoreStrip({
  model,
}: {
  model: ArenaOverlayDisplayModel
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
      {tile('Warning State', model.warningState.split('_').join(' '), model.warningReason ?? undefined)}
      {tile('Scenario Hint', model.scenarioHint)}
      {tile(
        'MC Crash Risk',
        model.mcOverlay ? formatScore(model.mcOverlay.mcCrashRiskScore) : 'Unavailable',
        model.mcOverlay ? '0-100 overlay score' : 'Monte Carlo overlay unavailable'
      )}
      {tile(
        'MC Recovery Odds (20d)',
        model.mcOverlay ? formatScore(model.mcOverlay.mcRecoveryOdds20d) : 'Unavailable',
        model.mcOverlay ? 'Meaningful recovery odds' : 'Rule-based warning remains primary'
      )}
      {tile(
        'MC Bear Similarity',
        model.mcOverlay ? formatScore(model.mcOverlay.mcBearPathSimilarity) : 'Unavailable',
        model.mcOverlay
          ? `Grinding-bear path similarity | Regime ${model.mcOverlay.mcCurrentRegime}`
          : 'No MC library loaded'
      )}
      {tile(
        'Trust Score',
        model.mcOverlay ? formatScore(model.mcOverlay.mcTrustScore) : 'Unavailable',
        model.mcOverlay
          ? `Historical reliability | ${model.mcOverlay.mcCalibrationBucket.split('_').join(' ')}`
          : 'Calibration table unavailable'
      )}
    </div>
  )
}
