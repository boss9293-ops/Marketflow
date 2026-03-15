import type { ToneCode, ToneName } from './toneSelector'

export type NarrativeArticle = {
  title?: string | null
  publisher?: string | null
  published_at?: string | null
  url?: string | null
}

export type NarrativeInput = {
  toneCode: ToneCode
  toneName: ToneName
  sensors: {
    lpiBand?: string | null
    rpiBand?: string | null
    vriBand?: string | null
    xconf?: string | null
    ghedge?: string | null
    structure?: '강' | '중립' | '약'
  }
  articles: NarrativeArticle[]
}

export type NarrativeOutput = {
  title: string
  subtitle: string
  paragraphs: string[]
  sources: string[]
}

const FORBIDDEN = [
  /\b오를 것이다\b/g,
  /\b내릴 것이다\b/g,
  /\b폭락한다\b/g,
  /\b매수\b/g,
  /\b매도\b/g,
  /\b진입\b/g,
  /\b청산\b/g,
  /\b목표가\b/g,
  /\b가격 예측\b/g,
  /\b확정\b/g,
  /\b보장\b/g,
  /\b반드시\b/g,
  /\bwill\b/gi,
  /\bcrash\b/gi,
  /\bbuy\b/gi,
  /\bsell\b/gi,
  /\bguarantee(d)?\b/gi,
  /\b폭락\b/g,
  /\b확실히\b/g,
  /\b급등할 것\b/g,
  /\bmust\b/gi,
]

const ACTIONS: Record<ToneCode, string> = {
  T0: '특별한 행동이 필요한 날은 아닙니다. 기존 계획을 유지하십시오.',
  T1: '확인 모드입니다. 신규 확장보다 분할 규율을 유지하십시오.',
  T2: '속도 조절 구간입니다. 상단 노출을 보수적으로 관리하십시오.',
  T3: '방어 우선 구간입니다. 레버리지 상단을 제한하고 리스크 점검을 강화하십시오.',
  T4: '긴장 구간입니다. 노출을 보수적으로 재점검하십시오.',
}

function sanitizeLine(text: string): string {
  let out = text
  for (const rx of FORBIDDEN) out = out.replace(rx, '관리')
  return out
}

function pickSources(articles: NarrativeArticle[]): string[] {
  return (articles || [])
    .slice(0, 2)
    .map((a) => `Yahoo Finance (${a.publisher || 'Unknown'}, ${String(a.published_at || '').slice(0, 16).replace('T', ' ')})`)
}

function structureText(v?: '강' | '중립' | '약'): string {
  if (v === '강') return '강'
  if (v === '약') return '약'
  return '중립'
}

function openingLine(tone: ToneCode): string {
  if (tone === 'T0') return '지금 시장은 숨을 고르며 균형을 찾는 모습입니다.'
  if (tone === 'T1') return '오늘 시장은 조용하지만 완전히 안심할 단계는 아닙니다.'
  if (tone === 'T2') return '지금은 겉보기보다 내부 압력을 더 확인해야 하는 구간입니다.'
  if (tone === 'T3') return '시장의 표면은 버티지만 내부 긴장감은 높아진 상태입니다.'
  return '지금은 긴장감을 유지하며 한 번 더 점검해야 하는 구간입니다.'
}

function newsContextLines(articles: NarrativeArticle[]): string[] {
  const items = (articles || []).slice(0, 2)
  if (items.length === 0) return ['오늘은 뉴스보다 센서 신호를 우선해 맥락을 읽습니다.']
  return items.map((a) => {
    const t = String(a.title || '').toLowerCase()
    if (t.includes('fed') || t.includes('powell') || t.includes('rate') || t.includes('yield')) {
      return '오늘 연준/금리 관련 이슈가 압력 해석의 배경으로 작동하고 있습니다.'
    }
    if (t.includes('inflation') || t.includes('cpi') || t.includes('ppi')) {
      return '최근 물가 관련 보도는 금리 경로에 대한 확인 단계를 요구하고 있습니다.'
    }
    if (t.includes('vix') || t.includes('volatility') || t.includes('risk')) {
      return '변동성 관련 보도는 속도 관리 필요성을 다시 확인시키고 있습니다.'
    }
    return '오늘 주요 뉴스는 센서가 보여주는 구조적 압력의 배경 맥락을 보강합니다.'
  })
}

export function buildMarketNarrative(input: NarrativeInput): NarrativeOutput {
  const lpi = input.sensors.lpiBand || 'Neutral'
  const rpi = input.sensors.rpiBand || 'Stable'
  const vri = input.sensors.vriBand || 'Normal'
  const xconf = input.sensors.xconf || 'Mixed'
  const ghedge = input.sensors.ghedge || 'Mixed'
  const struct = structureText(input.sensors.structure)

  const lpiKo = lpi === 'Easy' ? '완화' : lpi === 'Tight' ? '타이트' : lpi === 'Neutral' ? '중립' : lpi
  const rpiKo = rpi === 'Easing' ? '완화' : rpi === 'Restrictive' ? '높은 압력' : rpi === 'Stable' ? '안정' : rpi
  const vriKo = vri === 'Compressed' ? '낮은 긴장' : vri === 'Expanding' ? '긴장 확대' : vri === 'Normal' ? '보통 긴장' : vri
  const xconfKo = xconf === 'Align' ? '정렬된' : xconf === 'Stress' ? '긴장된' : '엇갈린'
  const ghedgeKo = ghedge === 'HedgeDemand' ? '강하게' : ghedge === 'Normal' ? '완만하게' : '혼합적으로'
  const posture = ACTIONS[input.toneCode] || ACTIONS.T1

  const opening = openingLine(input.toneCode)
  const macro1 = `지금 시중에 도는 돈의 흐름은 ${lpiKo} 상태입니다.`
  const macro2 = `이 말은 시장을 밀어주는 힘이 ${lpi === 'Easy' ? '비교적 살아' : lpi === 'Tight' ? '약해져' : '크게 한쪽으로 기울지 않아'} 있다는 뜻입니다.`
  const rate1 = '금리는 자금의 비용입니다.'
  const rate2 = `지금 금리는 ${rpiKo} 상태라, 성장주나 레버리지에 ${rpi === 'Restrictive' ? '부담' : rpi === 'Easing' ? '완충' : '선별적'} 영향을 줄 수 있습니다.`
  const vol1 = '변동성은 시장의 긴장도입니다.'
  const vol2 = `지금은 ${vriKo} 단계라 움직임의 속도가 ${vri === 'Expanding' ? '빨라질' : vri === 'Compressed' ? '완만할' : '들쭉날쭉할'} 수 있습니다.`
  const cross1 = `비트코인은 위험을 먼저 반영하는 자산입니다. 지금은 유동성과 ${xconfKo} 관계를 보이고 있습니다.`
  const cross2 = `이 말은 신호를 한 번 더 확인해야 한다는 뜻입니다. 금은 지금 ${ghedgeKo} 움직이고 있어 방어 수요를 ${ghedge === 'HedgeDemand' ? '시사합니다' : '점검하게 합니다'}.`
  const structure = `정리하면 시장 구조는 ${struct} 단계이며, 확산이 받쳐주는지 확인이 필요합니다.`
  const closing = `그래서 오늘은 ${posture}`
  const newsLines = newsContextLines(input.articles)

  const paragraphs = [
    opening,
    macro1,
    macro2,
    rate1,
    rate2,
    vol1,
    vol2,
    cross1,
    cross2,
    structure,
    closing,
    ...newsLines.slice(0, 2),
  ]
    .slice(0, 12)
    .map(sanitizeLine)

  return {
    title: sanitizeLine(`오늘의 시장 톤: ${input.toneName}`),
    subtitle: sanitizeLine(`${lpi}/${rpi}/${vri} · 확인:${xconf}`),
    paragraphs,
    sources: pickSources(input.articles),
  }
}
