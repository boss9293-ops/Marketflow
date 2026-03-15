import Link from 'next/link'

export default function CrashNavigatorGuidePage() {
  return (
    <main style={{
      minHeight: '100vh',
      background: '#0a0f1a',
      color: '#e5e7eb',
      fontFamily: "'Inter','Segoe UI',sans-serif",
      padding: '2.6rem 1.95rem',
    }}>
      <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
        <div style={{
          background: '#111318',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 14,
          padding: '1.6rem 1.8rem',
        }}>
          <div style={{ fontSize: '1.9rem', fontWeight: 800, marginBottom: 6 }}>레버리지 길들이기 사용 가이드</div>
          <div style={{ fontSize: '0.95rem', color: '#cbd5f5' }}>
            레버리지는 강력한 도구입니다. 그러나 통제되지 않으면 치명적일 수 있습니다. 본 공간은 레버리지를 통제하는 절차와 원칙을 제공합니다.
          </div>
        </div>

        <div style={{ display: 'grid', gap: '1rem' }}>
          <section style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1.1rem 1.2rem' }}>
            <div style={{ fontSize: '0.88rem', color: '#9ca3af', marginBottom: 6 }}>이것은 무엇인가</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.92rem', lineHeight: 1.6 }}>
              <li>이 엔진은 “미래를 맞추는 AI”가 아닙니다.</li>
              <li>현재 시장이 어떤 국면인지(가속/방어/패닉/안정화/구조적)를 분류합니다.</li>
              <li>그 국면에서 “지금 할 일 / 하지 말 일”을 명확히 제시합니다.</li>
            </ul>
          </section>

          <section style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1.1rem 1.2rem' }}>
            <div style={{ fontSize: '0.88rem', color: '#9ca3af', marginBottom: 6 }}>이것은 무엇을 해주는가</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.92rem', lineHeight: 1.6 }}>
              <li>Acting Point(행동 시점)를 제공합니다.</li>
              <li>Trigger Distance(임계치까지 남은 거리)를 보여줍니다.</li>
              <li>급락 상위 퍼센타일(통계적 위치)을 근거로 제시합니다.</li>
              <li>장기 하락장(STRUCTURAL)에서는 행동 빈도를 제한해 멘탈 피로를 줄입니다.</li>
            </ul>
          </section>

          <section style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1.1rem 1.2rem' }}>
            <div style={{ fontSize: '0.88rem', color: '#9ca3af', marginBottom: 6 }}>이것은 무엇을 하지 않는가</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.92rem', lineHeight: 1.6 }}>
              <li>“지금이 바닥/고점”을 단정하지 않습니다.</li>
              <li>“반드시 반등/반드시 하락” 같은 예언을 하지 않습니다.</li>
              <li>빠른 갭 하락(야간 폭락)은 100% 방어할 수 없습니다.</li>
            </ul>
          </section>

          <section style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1.1rem 1.2rem' }}>
            <div style={{ fontSize: '0.88rem', color: '#9ca3af', marginBottom: 6 }}>3단계 사용법 (가장 중요)</div>
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              <div>
                <div style={{ fontSize: '0.92rem', fontWeight: 600 }}>1) WATCH(가속 주의)</div>
                <div style={{ fontSize: '0.9rem', color: '#cbd5f5' }}>신규 매수 중단 · 방어 준비(주문/계획 확인)</div>
              </div>
              <div>
                <div style={{ fontSize: '0.92rem', fontWeight: 600 }}>2) DEFENSE(생존 모드)</div>
                <div style={{ fontSize: '0.9rem', color: '#cbd5f5' }}>자산 보호가 목표 · 계획된 비율로 축소, 관망 전환</div>
              </div>
              <div>
                <div style={{ fontSize: '0.92rem', fontWeight: 600 }}>3) STABILIZATION(안정화)</div>
                <div style={{ fontSize: '0.9rem', color: '#cbd5f5' }}>
                  10% 탐색 → 5% 추가 → 조건 확인 후 단계 확대 · fake bounce는 정상이며, 규칙대로 “잠시 관망”으로 복귀
                </div>
              </div>
            </div>
          </section>

          <section style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1.1rem 1.2rem' }}>
            <div style={{ fontSize: '0.88rem', color: '#9ca3af', marginBottom: 6 }}>멘탈 안정 계약 (Psychology Contract)</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.92rem', lineHeight: 1.6 }}>
              <li>지금의 목표는 “수익 극대화”가 아니라 “파산 방지와 심리 안정”입니다.</li>
              <li>불확실성은 정상입니다. 시스템은 확률과 근거로 말합니다.</li>
              <li>감정적 충동(패닉 매도/추격 매수)을 줄이는 것이 장기적으로 가장 중요합니다.</li>
              <li>“계획된 절차가 진행 중”이라는 신호 자체가 안정감을 줍니다.</li>
            </ul>
          </section>

          <section style={{ background: '#111318', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1.1rem 1.2rem' }}>
            <div style={{ fontSize: '0.88rem', color: '#9ca3af', marginBottom: 6 }}>면책 및 주의</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.92rem', lineHeight: 1.6 }}>
              <li>투자 자문이 아닙니다. 손실 가능성이 있습니다.</li>
              <li>레버리지 상품은 변동성이 매우 크며, 단기간 큰 손실이 발생할 수 있습니다.</li>
              <li>본 시스템은 정보 제공 및 의사결정 보조 목적이며, 최종 책임은 사용자에게 있습니다.</li>
            </ul>
          </section>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.6rem' }}>
          <Link
            href="/crash/navigator"
            style={{
              background: '#0f1116',
              color: '#e5e7eb',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 10,
              padding: '0.5rem 0.9rem',
              fontSize: '0.85rem',
              textDecoration: 'none',
            }}
          >
            Navigator로 돌아가기
          </Link>
          <div style={{ fontSize: '0.78rem', color: '#7b8499' }}>표준 매뉴얼 v1.0 (Balanced)</div>
        </div>
      </div>
    </main>
  )
}
