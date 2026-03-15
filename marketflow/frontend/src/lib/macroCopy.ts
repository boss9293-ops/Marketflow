export type Lang = 'KR' | 'EN'

export type MacroTermKey =
  | 'MPS'
  | 'LPI'
  | 'RPI'
  | 'VRI'
  | 'CSI'
  | 'VIX'
  | 'HY_OAS'
  | 'REALIZED_VOL'
  | 'YTD_VS_DD'
  | 'BANDS_PERCENTILES'

export const MACRO_TERM_COPY: Record<MacroTermKey, { KR: { title: string; body: string }; EN: { title: string; body: string } }> = {
  MPS: {
    KR: {
      title: 'MPS',
      body: 'MPS는 유동성(LPI), 변동성(VRI), 금리(RPI), 신용(CSI)을 통합한 ‘환경 압력’ 점수(0~100)입니다. 높을수록 공격적 확장보다 ‘속도 조절’이 유리합니다. 방향 예측 지표가 아닙니다.',
    },
    EN: {
      title: 'MPS',
      body: 'MPS is an environment pressure score (0–100) combining Liquidity (LPI), Volatility (VRI), Rate Pressure (RPI), and Credit Stress (CSI). Higher scores suggest speed control, not directional prediction.',
    },
  },
  LPI: {
    KR: {
      title: '유동성(LPI)',
      body: '시장 유동성의 ‘압박 정도’를 나타냅니다. M2, WALCL(연준 대차대조표), RRP 같은 유동성 지표가 타이트해질수록 LPI가 상승합니다.',
    },
    EN: {
      title: 'Liquidity (LPI)',
      body: 'Liquidity pressure measure. LPI rises when liquidity proxies (M2, Fed balance sheet/WALCL, RRP) tighten.',
    },
  },
  RPI: {
    KR: {
      title: '금리(RPI)',
      body: '금리/실질금리 부담의 상대 강도입니다. 정책금리, 10Y, 2s10s 등 금리 환경이 ‘리스크 자산에 부담’일수록 RPI가 상승합니다.',
    },
    EN: {
      title: 'Rate Pressure (RPI)',
      body: 'Rate pressure on risk assets. RPI rises when rates/real rates and curve signals imply tighter conditions.',
    },
  },
  VRI: {
    KR: {
      title: '변동성(VRI)',
      body: '변동성 체계가 ‘확장(Expanding)’인지 ‘압축(Compressed)’인지 봅니다. VIX와 실현변동성의 상승은 레버리지 민감도를 급격히 키웁니다.',
    },
    EN: {
      title: 'Volatility (VRI)',
      body: 'Volatility regime measure. Rising VIX/realized vol increases leverage sensitivity and fragility.',
    },
  },
  CSI: {
    KR: {
      title: '신용(CSI)',
      body: '신용시장 스트레스(하이일드 스프레드 등)의 상대 강도입니다. CSI 상승은 금융여건 악화/디레버리징 위험이 커졌음을 시사합니다.',
    },
    EN: {
      title: 'Credit Stress (CSI)',
      body: 'Credit stress indicator (e.g., HY spreads). Rising CSI often precedes tightening conditions and deleveraging risk.',
    },
  },
  VIX: {
    KR: {
      title: 'VIX',
      body: '옵션시장이 반영하는 기대 변동성입니다. 급등은 위험회피 강화와 함께 나타나는 경우가 많습니다.',
    },
    EN: {
      title: 'VIX',
      body: 'Implied volatility (expected volatility from options). Spikes often coincide with risk-off behavior.',
    },
  },
  HY_OAS: {
    KR: {
      title: 'HY OAS',
      body: '하이일드 채권의 옵션조정스프레드. 스프레드 확대는 신용 스트레스 상승을 의미합니다.',
    },
    EN: {
      title: 'HY OAS',
      body: 'High-yield option-adjusted spread. Widening indicates rising credit stress.',
    },
  },
  REALIZED_VOL: {
    KR: {
      title: 'REALIZED_VOL',
      body: '실현변동성(최근 가격 움직임의 실제 변동). 상승은 ‘속도 위험(speed risk)’을 키웁니다.',
    },
    EN: {
      title: 'REALIZED_VOL',
      body: 'Realized volatility. Higher realized vol increases speed risk and fragility.',
    },
  },
  YTD_VS_DD: {
    KR: {
      title: 'YTD vs Drawdown',
      body: 'YTD는 1/1 대비 수익률(연초 기준)이고, Drawdown은 ‘최근 고점 대비 하락률’입니다. 패턴 연구 목적이면 YTD가 직관적이고, 리스크 연구(낙폭/회복)에는 Drawdown이 더 유리합니다.',
    },
    EN: {
      title: 'YTD vs Drawdown',
      body: 'YTD is return since Jan 1. Drawdown is decline from a recent peak. YTD is intuitive for yearly context; drawdown is better for risk-depth/recovery studies.',
    },
  },
  BANDS_PERCENTILES: {
    KR: {
      title: 'Bands / Percentiles',
      body: 'Bands는 과거 분포(퍼센타일) 기준 구간입니다. Normal/Watch/Risk는 ‘드문 정도(분포상 위치)’를 의미하며, 절대 예측이 아닙니다.',
    },
    EN: {
      title: 'Bands / Percentiles',
      body: 'Bands are percentile-based ranges. Normal/Watch/Risk reflect rarity in historical distribution, not certainty.',
    },
  },
}
