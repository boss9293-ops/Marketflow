export type ContextTone = 'Constructive' | 'Neutral' | 'Cautious' | 'Defensive' | 'Uncertain'

type MacroInput = {
  lpiBand?: string | null
  rpiBand?: string | null
  vriBand?: string | null
  xconfLabel?: string | null
  mps?: number | null
}

type HealthInput = {
  breadthScore?: number | null
  participationLabel?: string | null
  trendStrengthBand?: string | null
}

type StateInput = {
  regimeLabel?: string | null
  crashPhase?: boolean
}

export type MarketContextResult = {
  tone: ContextTone
  shortDescriptor: string
  shortDescriptorKo: string
  macroTone: 'Pressure Elevated' | 'Macro Neutral' | 'Macro Supportive'
  macroVol: 'Volatility Expanding' | 'Volatility Stable'
  structureTone: 'Internal Weakness' | 'Broad Participation' | 'Mixed Internals'
  regimeModifier: 'Risk-Controlled Environment' | 'Normal Regime'
  summaryLine: string
  blocks: [
    { key: 'environment'; title: string; body: string; titleKo: string; bodyKo: string },
    { key: 'structure'; title: string; body: string; titleKo: string; bodyKo: string },
    { key: 'sensitivity'; title: string; body: string; titleKo: string; bodyKo: string },
    { key: 'posture'; title: string; body: string; titleKo: string; bodyKo: string },
  ]
}

const FORBIDDEN = [
  /\bcrash\b/gi,
  /\bwill\b/gi,
  /\bguarantee\b/gi,
  /\bguaranteed\b/gi,
  /\bbuy\b/gi,
  /\bsell\b/gi,
  /\bstrong upside\b/gi,
]

function sanitize(text: string): string {
  let out = text
  let changed = false
  for (const rx of FORBIDDEN) {
    if (rx.test(out)) {
      out = out.replace(rx, 'context')
      changed = true
    }
  }
  if (changed && process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.warn('[MarketContext] forbidden wording sanitized')
  }
  return out
}

function normalizeRegime(v?: string | null): 'Normal' | 'Caution' | 'Defensive' | 'Shock' {
  const s = String(v || '').toLowerCase()
  if (s.includes('shock')) return 'Shock'
  if (s.includes('defensive') || s.includes('bear') || s.includes('high')) return 'Defensive'
  if (s.includes('caution') || s.includes('neutral') || s.includes('mixed')) return 'Caution'
  return 'Normal'
}

export function classifyMarketContext(params: {
  macro: MacroInput
  health: HealthInput
  state: StateInput
}): MarketContextResult {
  const lpi = String(params.macro.lpiBand || 'Neutral')
  const rpi = String(params.macro.rpiBand || 'Stable')
  const vri = String(params.macro.vriBand || 'Normal')
  const mps = typeof params.macro.mps === 'number' ? params.macro.mps : null
  const breadthScore = typeof params.health.breadthScore === 'number' ? params.health.breadthScore : null
  const participationLabel = String(params.health.participationLabel || '').toLowerCase()
  const trendStrength = String(params.health.trendStrengthBand || '').toLowerCase()
  const regime = normalizeRegime(params.state.regimeLabel)

  const macroTone: MarketContextResult['macroTone'] =
    (lpi === 'Tight' && rpi === 'Restrictive') || (mps !== null && mps >= 66)
      ? 'Pressure Elevated'
      : (lpi === 'Easy' && (rpi === 'Easing' || rpi === 'Stable'))
        ? 'Macro Supportive'
        : 'Macro Neutral'

  const macroVol: MarketContextResult['macroVol'] = vri === 'Expanding' ? 'Volatility Expanding' : 'Volatility Stable'

  const breadthWeak =
    (breadthScore !== null && breadthScore <= 12) ||
    participationLabel.includes('narrow') ||
    participationLabel.includes('weak') ||
    participationLabel.includes('협소') ||
    trendStrength.includes('weak')
  const breadthStrong =
    (breadthScore !== null && breadthScore >= 18) ||
    participationLabel.includes('broad') ||
    participationLabel.includes('strong') ||
    participationLabel.includes('확산') ||
    trendStrength.includes('strong')
  const structureTone: MarketContextResult['structureTone'] =
    breadthWeak ? 'Internal Weakness'
    : breadthStrong ? 'Broad Participation'
    : 'Mixed Internals'

  const regimeModifier: MarketContextResult['regimeModifier'] =
    params.state.crashPhase || regime === 'Defensive' || regime === 'Shock'
      ? 'Risk-Controlled Environment'
      : 'Normal Regime'

  let tone: ContextTone = 'Uncertain'
  if (macroTone === 'Pressure Elevated' && structureTone === 'Internal Weakness' && macroVol === 'Volatility Expanding') {
    tone = 'Defensive'
  } else if (macroTone === 'Macro Neutral' && structureTone === 'Mixed Internals') {
    tone = 'Cautious'
  } else if (macroTone === 'Macro Supportive' && structureTone === 'Broad Participation') {
    tone = 'Constructive'
  } else if (macroTone === 'Macro Neutral' && structureTone === 'Broad Participation' && macroVol === 'Volatility Stable') {
    tone = 'Neutral'
  } else if (regimeModifier === 'Risk-Controlled Environment') {
    tone = 'Cautious'
  }

  const environment = macroTone === 'Pressure Elevated'
    ? {
        body: 'Liquidity and rates are running in a warmer pressure zone, so funding conditions feel tighter than average.',
        bodyKo: '유동성과 금리는 상대적으로 뜨거운 압력 구간으로, 평균 대비 자금 여건이 타이트하게 느껴지는 상태입니다.',
      }
    : macroTone === 'Macro Supportive'
      ? {
          body: 'Liquidity and rates are in a cooler pressure zone, giving the market a steadier background.',
          bodyKo: '유동성과 금리는 상대적으로 완화된 압력 구간으로, 시장 배경이 비교적 안정적입니다.',
        }
      : {
          body: 'Liquidity and rates are near the middle of their historical pressure range without an extreme tilt.',
          bodyKo: '유동성과 금리는 역사적 압력 범위의 중간 영역으로, 한쪽으로 기운 극단 신호는 제한적입니다.',
        }

  const structure = structureTone === 'Internal Weakness'
    ? {
        body: 'Breadth is narrowing and participation is concentrated, so internal support looks thinner.',
        bodyKo: '브레드스가 좁아지고 참여가 집중되어 내부 지지력이 얇아진 구간입니다.',
      }
    : structureTone === 'Broad Participation'
      ? {
          body: 'Breadth is broad with wider participation, so internal support appears healthier.',
          bodyKo: '브레드스가 넓고 참여가 확산되어 내부 지지력이 상대적으로 건강한 구간입니다.',
        }
      : {
          body: 'Breadth and participation are mixed, so internal confirmation remains incomplete.',
          bodyKo: '브레드스와 참여 신호가 혼재되어 내부 확인 신호가 완결되지 않은 상태입니다.',
        }

  const sensitivity = macroVol === 'Volatility Expanding'
    ? {
        body: 'Volatility is expanding versus 3-year history. Position-size outcomes vary more, and leverage sensitivity rises.',
        bodyKo: '변동성 레짐이 3년 기준 대비 확장되어 포지션 크기에 따른 결과 분산이 커지고 레버리지 민감도가 올라갑니다.',
      }
    : {
        body: 'Volatility is stable versus 3-year history. Position-size outcomes are comparatively steadier.',
        bodyKo: '변동성 레짐이 3년 기준 대비 안정 구간으로, 포지션 크기에 따른 결과 변동이 상대적으로 완만합니다.',
      }

  const posture = tone === 'Defensive'
    ? {
        body: 'Investor posture: conservative sizing, with tighter risk pacing in implementation.',
        bodyKo: '투자자 자세: 보수적 사이징 중심, 실행 속도는 더 촘촘한 리스크 페이싱이 적절합니다.',
      }
    : tone === 'Cautious'
      ? {
          body: 'Investor posture: observe and validate, adding exposure only after additional confirmation.',
          bodyKo: '투자자 자세: 관찰과 검증 우선, 추가 확인 이후에만 익스포저 확장을 고려하는 자세가 적절합니다.',
        }
      : tone === 'Neutral'
        ? {
            body: 'Investor posture: balanced stance, keeping expansion and defense in measured proportion.',
            bodyKo: '투자자 자세: 균형적 스탠스 유지, 확장과 방어를 측정 가능한 비율로 병행하는 접근이 적절합니다.',
          }
        : tone === 'Constructive'
          ? {
              body: 'Investor posture: maintain stance with disciplined sizing while preserving risk controls.',
              bodyKo: '투자자 자세: 현재 스탠스 유지, 리스크 통제를 보존한 규율적 사이징이 적절합니다.',
            }
          : {
              body: 'Investor posture: observe until signals align, avoiding over-commitment in either direction.',
              bodyKo: '투자자 자세: 신호 정렬 전까지 관찰 중심, 어느 한쪽으로의 과도한 베팅은 피하는 자세가 적절합니다.',
            }

  const shortDescriptor = tone === 'Constructive'
    ? 'supportive backdrop'
    : tone === 'Neutral'
      ? 'balanced conditions'
      : tone === 'Cautious'
        ? 'mixed pressure'
        : tone === 'Defensive'
          ? 'elevated sensitivity'
          : 'confirmation incomplete'
  const shortDescriptorKo = tone === 'Constructive'
    ? '우호적 배경'
    : tone === 'Neutral'
      ? '균형 구간'
      : tone === 'Cautious'
        ? '혼합 압력'
        : tone === 'Defensive'
          ? '민감도 상승'
          : '확인 미완료'

  return {
    tone,
    shortDescriptor: sanitize(shortDescriptor),
    shortDescriptorKo: sanitize(shortDescriptorKo),
    macroTone,
    macroVol,
    structureTone,
    regimeModifier,
    summaryLine: sanitize(`Today's market tone: ${tone}.`),
    blocks: [
      {
        key: 'environment',
        title: 'Environment Temperature',
        titleKo: '환경 온도',
        body: sanitize(environment.body),
        bodyKo: sanitize(environment.bodyKo),
      },
      {
        key: 'structure',
        title: 'Internal Structure',
        titleKo: '내부 구조',
        body: sanitize(structure.body),
        bodyKo: sanitize(structure.bodyKo),
      },
      {
        key: 'sensitivity',
        title: 'Risk Sensitivity',
        titleKo: '리스크 민감도',
        body: sanitize(sensitivity.body),
        bodyKo: sanitize(sensitivity.bodyKo),
      },
      {
        key: 'posture',
        title: 'Investor Posture',
        titleKo: '투자자 자세',
        body: sanitize(posture.body),
        bodyKo: sanitize(posture.bodyKo),
      },
    ],
  }
}

export function tonePanelClass(tone: ContextTone): string {
  if (tone === 'Constructive') return 'from-emerald-500/10 to-emerald-400/5 border-emerald-400/20'
  if (tone === 'Neutral') return 'from-slate-500/10 to-slate-400/5 border-slate-400/20'
  if (tone === 'Cautious') return 'from-amber-500/10 to-amber-400/5 border-amber-400/20'
  if (tone === 'Defensive') return 'from-rose-500/10 to-red-500/5 border-rose-400/20'
  return 'from-sky-500/10 to-slate-500/5 border-sky-400/20'
}
