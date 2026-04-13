import { useState } from 'react'
import type { ArenaOverlayDisplayModel } from '../../lib/arena/overlay/buildArenaOverlayDisplayModel'

function formatScore(value: number) {
  return `${Math.round(value)}`
}

function formatOdds(value: number) {
  return `${Math.round(value * 100)}%`
}

function scoreRow(label: string, value: string, detail?: string) {
  return (
    <tr key={label}>
      <td style={{ padding: '0.8rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#e5e7eb', fontSize: '0.84rem', fontWeight: 700 }}>
        {label}
      </td>
      <td style={{ padding: '0.8rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#f8fafc', fontSize: '0.92rem', fontWeight: 800, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </td>
      <td style={{ padding: '0.8rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#cbd5e1', fontSize: '0.76rem', textAlign: 'left' }}>
        {detail || '-'}
      </td>
    </tr>
  )
}

export default function MonteCarloOverlayCard({
  model,
}: {
  model: ArenaOverlayDisplayModel
}) {
  const [tableVisible, setTableVisible] = useState(true)

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
      <div style={{ color: '#f8fafc', fontSize: '1rem', fontWeight: 800 }}>Monte Carlo 시뮬레이션</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 14 }}>
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '0.85rem 1rem' }}>
          <div style={{ color: '#7dd3fc', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>무엇인가?</div>
          <div style={{ color: '#e2e8f0', fontSize: '0.82rem', lineHeight: 1.65 }}>
            무작위 샘플링을 수천 번 반복해 현재 시장 구간과 <b>유사한 과거 스트레스 패턴</b>을 탐색하고, 그 이후 경로의 확률 분포를 추정하는 통계 기법입니다.
          </div>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '0.85rem 1rem' }}>
          <div style={{ color: '#86efac', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>어떻게 적용되나?</div>
          <div style={{ color: '#e2e8f0', fontSize: '0.82rem', lineHeight: 1.65 }}>
            현재 구간(하락·패닉·회복 등)과 비슷한 과거 사례를 합성해 <b>20~60일 경로를 시뮬레이션</b>하고, 규칙 기반 경고 레이어와 비교해 해석 일치도를 계산합니다.
          </div>
        </div>
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 12, padding: '0.85rem 1rem' }}>
          <div style={{ color: '#fbbf24', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>장점</div>
          <div style={{ color: '#e2e8f0', fontSize: '0.82rem', lineHeight: 1.65 }}>
            V자 반등·추가 하락·회복 전환 등 각 시나리오의 <b>확률을 수치로 제시</b>해, 단일 규칙보다 풍부한 맥락을 제공합니다. Agreement·Conflict Score로 신뢰도도 확인 가능합니다.
          </div>
        </div>
      </div>

      <div style={{ marginTop: 10, padding: '0.65rem 0.9rem', background: 'rgba(255,255,255,0.02)', borderRadius: 8, borderLeft: '2px solid rgba(148,163,184,0.3)' }}>
        <div style={{ color: '#94a3b8', fontSize: '0.77rem', lineHeight: 1.6 }}>
          <b style={{ color: '#cbd5e1' }}>현재 해석:</b> {model.humanReadable.summaryLine}
        </div>
      </div>
      <button
        style={{ background: 'transparent', border: 'none', color: '#7dd3fc', cursor: 'pointer', fontSize: '0.8rem', padding: '8px 0 4px 0', fontWeight: 500 }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.8')}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
        onClick={() => setTableVisible(!tableVisible)}
      >
        {tableVisible ? '▼ 상세 지표 숨기기' : '▶ 상세 지표 보기'}
      </button>
      {tableVisible && <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
            <th style={{ padding: '0.8rem 1rem', textAlign: 'left', color: '#94a3b8', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>Metric</th>
            <th style={{ padding: '0.8rem 1rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>Value</th>
            <th style={{ padding: '0.8rem 1rem', textAlign: 'left', color: '#94a3b8', fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase' }}>Description</th>
          </tr>
        </thead>
        <tbody>
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
        </tbody>
      </table>}
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
                {formatOdds(model.mcOverlay?.mcNextStateOdds[state] ?? 0)}
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
