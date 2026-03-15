export type MacroGlossaryKey =
  | 'MPS'
  | 'VIX'
  | 'LPI'
  | 'RPI'
  | 'VRI'
  | 'CSI'
  | 'REALIZED_VOL'
  | 'DD_VELOCITY'
  | 'QQQ_TQQQ_YTD'

export type MacroGlossaryEntry = {
  label: string
  KR: { meaning: string; watch: string }
  EN?: { meaning: string; watch: string }
}

export const MACRO_GLOSSARY: Record<MacroGlossaryKey, MacroGlossaryEntry> = {
  MPS: {
    label: 'MPS',
    KR: {
      meaning: '유동성/변동성/금리/크레딧을 합친 환경 압력 점수(0-100).',
      watch: '70+ 압력 구간, 85+ 고압 구간(속도 조절 권장).',
    },
    EN: {
      meaning: 'Macro pressure score (0-100) combining liquidity, vol, rates, credit.',
      watch: '70+ pressure, 85+ high pressure (favor speed control).',
    },
  },
  VIX: {
    label: 'VIX',
    KR: {
      meaning: '옵션시장의 기대 변동성 지표.',
      watch: '25+ 스트레스, 35+ 충격 구간 가능성 상승.',
    },
    EN: {
      meaning: 'Implied volatility index from options.',
      watch: '25+ stress, 35+ shock-prone zone.',
    },
  },
  LPI: {
    label: 'LPI',
    KR: {
      meaning: '유동성 압력 지표(M2/WALCL/RRP 등 기반).',
      watch: 'Tight 방향이면 리스크 자산 압력 증가.',
    },
    EN: {
      meaning: 'Liquidity pressure indicator from liquidity proxies.',
      watch: 'Tightening increases risk-asset pressure.',
    },
  },
  RPI: {
    label: 'RPI',
    KR: {
      meaning: '금리/실질금리/커브 기반의 금리 압력 지표.',
      watch: 'Restrictive이면 듀레이션 리스크 확대.',
    },
    EN: {
      meaning: 'Rate pressure from policy/rates/curve signals.',
      watch: 'Restrictive regime raises rate sensitivity.',
    },
  },
  VRI: {
    label: 'VRI',
    KR: {
      meaning: '변동성 레짐(확장/압축) 지표.',
      watch: '확장 시 레버리지·속도 리스크 확대.',
    },
    EN: {
      meaning: 'Volatility regime indicator.',
      watch: 'Expanding vol increases leverage/speed risk.',
    },
  },
  CSI: {
    label: 'CSI',
    KR: {
      meaning: '크레딧 스트레스 지표(HY 스프레드 등).',
      watch: '상승 시 디레버리징 위험 신호.',
    },
    EN: {
      meaning: 'Credit stress indicator (e.g., HY spreads).',
      watch: 'Rising CSI signals deleveraging risk.',
    },
  },
  REALIZED_VOL: {
    label: 'REALIZED_VOL',
    KR: {
      meaning: '실현 변동성(최근 가격 변동의 크기).',
      watch: '급등 시 스피드 리스크 → 포지션 속도 조절.',
    },
    EN: {
      meaning: 'Realized volatility from recent price moves.',
      watch: 'Spikes imply speed risk; trim pace.',
    },
  },
  DD_VELOCITY: {
    label: 'DD_VELOCITY',
    KR: {
      meaning: '단기간 낙폭 속도(급락 기울기).',
      watch: '속도가 빠를수록 크래시 위험 상승.',
    },
    EN: {
      meaning: 'Drawdown speed over short windows.',
      watch: 'Faster drops imply higher crash risk.',
    },
  },
  QQQ_TQQQ_YTD: {
    label: 'QQQ/TQQQ YTD',
    KR: {
      meaning: '연초 대비 누적 수익률(지수/레버리지).',
      watch: '레짐 반응 확인용이며 트리거가 아님.',
    },
    EN: {
      meaning: 'Cumulative return since Jan 1 (index/levered).',
      watch: 'Use for regime response, not triggers.',
    },
  },
}

export function getGlossaryTitle(key: MacroGlossaryKey): string {
  const entry = MACRO_GLOSSARY[key]
  const kr = `KR: ${entry.KR.meaning}\nKR: ${entry.KR.watch}`
  const en = entry.EN ? `\nEN: ${entry.EN.meaning}\nEN: ${entry.EN.watch}` : ''
  return `${entry.label}\n${kr}${en}`
}
