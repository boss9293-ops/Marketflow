import { NextResponse } from 'next/server'

import OpenAI from 'openai'

type BriefPayload = {
  asof?: string | null
  windowDays?: number | null
  focusDays?: number | null
  forceRefresh?: boolean | null
  mpsNow?: number | null
  vixNow?: number | null
  mpsRange?: { minVal?: number | null; minDate?: string | null; maxVal?: number | null; maxDate?: string | null }
  vixRange?: { minVal?: number | null; minDate?: string | null; maxVal?: number | null; maxDate?: string | null }
  qqqWindowReturn?: number | null
  tqqqWindowReturn?: number | null
  qqq5dChange?: number | null
  tqqq5dChange?: number | null
  qqq5dWorst?: { value?: number; startIndex?: number; endIndex?: number } | null
  qqq5dBest?: { value?: number; startIndex?: number; endIndex?: number } | null
  tqqq5dWorst?: { value?: number; startIndex?: number; endIndex?: number } | null
  tqqq5dBest?: { value?: number; startIndex?: number; endIndex?: number } | null
  qqq5dWorstDate?: string | null
  qqq5dBestDate?: string | null
  tqqq5dWorstDate?: string | null
  tqqq5dBestDate?: string | null
  stressDays?: number | null
}

type BriefResponse = {
  paragraphs: string[]
  warnings: string[]
  sources?: { title: string; url: string; date?: string }[]
  provider?: string
  model?: string
  fetchedAt?: string
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const GEMINI_TIMEOUT_MS = 20000
const OPENAI_MODEL = 'gpt-4o-mini'
const GEMINI_MODEL = 'gemini-2.0-flash-lite'
const GEMINI_FALLBACK_MODELS = ['gemini-1.5-flash', 'gemini-1.5-flash-8b']
const cache = new Map<string, { ts: number; data: BriefResponse }>()

const normalizeDay = (value?: string | null) => {
  if (!value) return 'na'
  return value.slice(0, 10)
}

const formatPct = (value: number | null | undefined, digits = 1) => {
  if (value == null || !Number.isFinite(value)) return '--'
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`
}

const formatNum = (value: number | null | undefined, digits = 0) => {
  if (value == null || !Number.isFinite(value)) return '--'
  return value.toFixed(digits)
}

const buildFallbackBrief = (payload: BriefPayload): BriefResponse => {
  const mpsNow = formatNum(payload.mpsNow, 0)
  const vixNow = formatNum(payload.vixNow, 1)
  const mpsMin = formatNum(payload.mpsRange?.minVal, 0)
  const mpsMax = formatNum(payload.mpsRange?.maxVal, 0)
  const mpsMinDate = payload.mpsRange?.minDate || '--'
  const mpsMaxDate = payload.mpsRange?.maxDate || '--'
  const vixMin = formatNum(payload.vixRange?.minVal, 1)
  const vixMax = formatNum(payload.vixRange?.maxVal, 1)
  const vixMinDate = payload.vixRange?.minDate || '--'
  const vixMaxDate = payload.vixRange?.maxDate || '--'
  const stressDays = payload.stressDays ?? 0
  const windowLabel = payload.windowDays ?? 60
  const asof = normalizeDay(payload.asof) || '--'

  const paragraphs: string[] = [
    `오늘 ${asof} 기준 MPS ${mpsNow}, VIX ${vixNow}이며, QQQ 5D ${formatPct(payload.qqq5dChange)} / TQQQ 5D ${formatPct(payload.tqqq5dChange)}의 단기 반응입니다.`,
    `최근 ${windowLabel}거래일 구간에서 압력/변동성 흐름을 확인합니다. 고점 날짜는 MPS ${mpsMaxDate}, VIX ${vixMaxDate}입니다.`,
    `MPS는 ${mpsMin} (${mpsMinDate}) → ${mpsMax} (${mpsMaxDate}) 범위에서 움직였고, 스트레스 데이는 ${stressDays}일입니다.`,
    `VIX는 ${vixMin} (${vixMinDate}) → ${vixMax} (${vixMaxDate})로 이동했으며, 스파이크 이후 회복 속도가 핵심입니다.`,
    `가격 반응: QQQ ${formatPct(payload.qqqWindowReturn)}, TQQQ ${formatPct(payload.tqqqWindowReturn)}. 최악 5D ${formatPct(payload.qqq5dWorst?.value)} (${payload.qqq5dWorstDate || '--'}), 최고 5D ${formatPct(payload.qqq5dBest?.value)} (${payload.qqq5dBestDate || '--'}).`,
  ]

  const warnings = [
    'MPS 70 이상 지속 시 압력 누적 가능성',
    'VIX 급등 속도는 가격 스트레스 선행 신호',
    'TQQQ 변동성 확대는 레버리지 리스크 확대',
  ]

  return {
    paragraphs,
    warnings,
    sources: [],
    provider: 'fallback',
    model: 'fallback',
    fetchedAt: new Date().toISOString(),
  }
}

const extractJson = (text: string): BriefResponse | null => {
  const cleaned = text.replace(/```json|```/g, '').trim()
  try {
    const parsed = JSON.parse(cleaned) as BriefResponse
    if (!Array.isArray(parsed.paragraphs)) return null
    return {
      paragraphs: parsed.paragraphs,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      sources: Array.isArray(parsed.sources) ? parsed.sources : [],
    }
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      const parsed = JSON.parse(match[0]) as BriefResponse
      if (!Array.isArray(parsed.paragraphs)) return null
      return {
        paragraphs: parsed.paragraphs,
        warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
        sources: Array.isArray(parsed.sources) ? parsed.sources : [],
      }
    } catch {
      return null
    }
  }
}

const buildGeminiRequest = (payload: BriefPayload, useSearch: boolean) => {
  const systemText = [
    '너는 미국 뉴욕 증시 데일리 브리핑 에디터다.',
    '하루 중 가장 핫한 뉴스(시장에 영향 큰 이슈)를 요약하고, 그날의 증시 반응을 연결해 설명한다.',
    '예측/매수/매도 금지. 과장/확신 금지. 해석 중심.',
    '항상 한국어로 4~6개의 짧은 단락을 작성한다.',
    'JSON만 반환한다.',
  ].join('\n')

  const prompt = [
    '다음 입력 데이터로 뉴욕 증시 데일리 브리핑을 작성하라.',
    '가능하다면 오늘 기준 가장 핫한 뉴스 1~3개를 검색해 요약하고, 시장 반응과 연결하라.',
    '뉴스가 없으면 데이터 중심 분석으로 대체한다.',
    '',
    `asof: ${normalizeDay(payload.asof)}`,
    `windowDays: ${payload.windowDays ?? 60}`,
    `MPS now: ${formatNum(payload.mpsNow, 0)}`,
    `VIX now: ${formatNum(payload.vixNow, 1)}`,
    `QQQ 5D: ${formatPct(payload.qqq5dChange)}`,
    `TQQQ 5D: ${formatPct(payload.tqqq5dChange)}`,
    `MPS range: ${formatNum(payload.mpsRange?.minVal, 0)} (${payload.mpsRange?.minDate || '--'}) -> ${formatNum(payload.mpsRange?.maxVal, 0)} (${payload.mpsRange?.maxDate || '--'})`,
    `VIX range: ${formatNum(payload.vixRange?.minVal, 1)} (${payload.vixRange?.minDate || '--'}) -> ${formatNum(payload.vixRange?.maxVal, 1)} (${payload.vixRange?.maxDate || '--'})`,
    `QQQ window return: ${formatPct(payload.qqqWindowReturn)}`,
    `TQQQ window return: ${formatPct(payload.tqqqWindowReturn)}`,
    `Worst 5D QQQ: ${formatPct(payload.qqq5dWorst?.value)} on ${payload.qqq5dWorstDate || '--'}`,
    `Best 5D QQQ: ${formatPct(payload.qqq5dBest?.value)} on ${payload.qqq5dBestDate || '--'}`,
    `Stress days: ${payload.stressDays ?? 0}`,
    '',
    '출력 포맷:',
    '{ "paragraphs": ["..."], "warnings": ["...","..."] }',
    'paragraphs 구성 가이드:',
    '1) 오늘의 핵심 뉴스 요약 2~3줄',
    '2) 시장 반응 요약 (지수/섹터/변동성)',
    '3) MPS/VIX/QQQ/TQQQ 숫자와 연결한 해석',
    '4) 리스크 체크포인트 1~2줄',
  ].join('\n')

  return {
    generationConfig: {
      temperature: 0.4,
      topP: 0.9,
      maxOutputTokens: 600,
      responseMimeType: 'application/json',
    },
    ...(useSearch ? { tools: [{ google_search: {} }] } : {}),
    systemInstruction: { parts: [{ text: systemText }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  }
}

const buildOpenAIInput = (payload: BriefPayload) => {
  const systemText = [
    '너는 미국 뉴욕 증시 데일리 브리핑 에디터다.',
    '하루 중 가장 핫한 뉴스(시장에 영향 큰 이슈)를 요약하고, 그날의 증시 반응을 연결해 설명한다.',
    '예측/매수/매도 금지. 과장/확신 금지. 해석 중심.',
    '항상 한국어로 4~6개의 짧은 단락을 작성한다.',
    'JSON만 반환한다.',
  ].join('\n')

  const prompt = [
    '다음 입력 데이터로 뉴욕 증시 데일리 브리핑을 작성하라.',
    '가능하다면 오늘 기준 가장 핫한 뉴스 1~3개를 검색해 요약하고, 시장 반응과 연결하라.',
    '뉴스가 없으면 데이터 중심 분석으로 대체한다.',
    '',
    `asof: ${normalizeDay(payload.asof)}`,
    `windowDays: ${payload.windowDays ?? 60}`,
    `MPS now: ${formatNum(payload.mpsNow, 0)}`,
    `VIX now: ${formatNum(payload.vixNow, 1)}`,
    `QQQ 5D: ${formatPct(payload.qqq5dChange)}`,
    `TQQQ 5D: ${formatPct(payload.tqqq5dChange)}`,
    `MPS range: ${formatNum(payload.mpsRange?.minVal, 0)} (${payload.mpsRange?.minDate || '--'}) -> ${formatNum(payload.mpsRange?.maxVal, 0)} (${payload.mpsRange?.maxDate || '--'})`,
    `VIX range: ${formatNum(payload.vixRange?.minVal, 1)} (${payload.vixRange?.minDate || '--'}) -> ${formatNum(payload.vixRange?.maxVal, 1)} (${payload.vixRange?.maxDate || '--'})`,
    `QQQ window return: ${formatPct(payload.qqqWindowReturn)}`,
    `TQQQ window return: ${formatPct(payload.tqqqWindowReturn)}`,
    `Worst 5D QQQ: ${formatPct(payload.qqq5dWorst?.value)} on ${payload.qqq5dWorstDate || '--'}`,
    `Best 5D QQQ: ${formatPct(payload.qqq5dBest?.value)} on ${payload.qqq5dBestDate || '--'}`,
    `Stress days: ${payload.stressDays ?? 0}`,
    '',
    '출력 포맷:',
    '{ "paragraphs": ["..."], "warnings": ["...","..."] }',
    'paragraphs 구성 가이드:',
    '1) 오늘의 핵심 뉴스 요약 2~3줄',
    '2) 시장 반응 요약 (지수/섹터/변동성)',
    '3) MPS/VIX/QQQ/TQQQ 숫자와 연결한 해석',
    '4) 리스크 체크포인트 1~2줄',
  ].join('\n')

  // Keep input as plain text for broad SDK compatibility.
  return `${systemText}\n\n${prompt}`
}

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs: number) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

const callGeminiBrief = async (payload: BriefPayload): Promise<BriefResponse | null> => {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? ''
  if (!apiKey) return null

  const runRequest = async (model: string, useSearch: boolean) => {
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
    const response = await fetchWithTimeout(
      endpoint,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildGeminiRequest(payload, useSearch)),
      },
      GEMINI_TIMEOUT_MS
    )
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '')
      throw new Error(`Gemini API ${response.status} (${model}) ${bodyText.slice(0, 200)}`)
    }
    const data = await response.json()
    const text: string | undefined =
      data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('').trim()
    if (!text) throw new Error('Gemini empty response')
    const parsed = extractJson(text)
    if (!parsed) throw new Error('Gemini JSON parse failed')
    const chunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks
    const sources = Array.isArray(chunks)
      ? chunks
          .map((c: any) => ({
            title: c?.web?.title ?? c?.retrieved?.title ?? 'Source',
            url: c?.web?.uri ?? c?.retrieved?.uri ?? '',
            date: c?.web?.publicationDate ?? c?.retrieved?.publicationDate ?? undefined,
          }))
          .filter((s: { url: string }) => Boolean(s.url))
      : []
    return {
      ...parsed,
      sources,
      provider: 'gemini',
      model,
      fetchedAt: new Date().toISOString(),
    }
  }

  const models = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS]
  for (const model of models) {
    try {
      console.info(`[live-brief] gemini request start (no search) ${model}`)
      return await runRequest(model, false)
    } catch (err) {
      console.error(`Gemini daily brief failed (${model})`, err)
    }

    try {
      console.info(`[live-brief] gemini request start (search) ${model}`)
      return await runRequest(model, true)
    } catch (err) {
      console.error(`Gemini daily brief failed with search tool (${model})`, err)
    }
  }

  return null
}

const callOpenAIBrief = async (payload: BriefPayload): Promise<BriefResponse | null> => {
  const apiKey = process.env.OPENAI_API_KEY ?? ''
  if (!apiKey) return null

  const openai = new OpenAI({ apiKey })
  const input = buildOpenAIInput(payload)
  const response = await openai.responses.create({
    model: OPENAI_MODEL,
    input,
  })

  const outputText = response.output_text
  if (!outputText) throw new Error('OpenAI empty response')
  const parsed = extractJson(outputText)
  if (!parsed) throw new Error('OpenAI JSON parse failed')
  return {
    ...parsed,
    provider: 'openai',
    model: OPENAI_MODEL,
    fetchedAt: new Date().toISOString(),
  }
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as BriefPayload | null
  if (!payload) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 })
  }

  const asofDay = normalizeDay(payload.asof)
  const key = asofDay
  const cached = cache.get(key)
  if (!payload.forceRefresh && cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return NextResponse.json(cached.data, {
      headers: {
        'Cache-Control': 'public, max-age=0, s-maxage=86400',
      },
    })
  }
  if (payload.forceRefresh) {
    cache.delete(key)
  }

  const fallback = buildFallbackBrief(payload)
  let data: BriefResponse | null = null

  if (process.env.OPENAI_API_KEY) {
    try {
      console.info('[live-brief] openai request start')
      data = await callOpenAIBrief(payload)
      if (data) console.info('[live-brief] openai response ok')
    } catch (err) {
      console.error('[live-brief] openai failed, using fallback', err)
      data = fallback
    }
  } else {
    console.warn('[live-brief] openai key missing, trying gemini')
    const geminiBrief = await callGeminiBrief(payload)
    if (geminiBrief) {
      console.info('[live-brief] gemini response ok')
      data = geminiBrief
    } else {
      console.warn('[live-brief] gemini unavailable, using fallback')
      data = fallback
    }
  }
  if (!data) {
    data = fallback
  }
  cache.set(key, { ts: Date.now(), data })

  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'public, max-age=0, s-maxage=86400',
    },
  })
}
