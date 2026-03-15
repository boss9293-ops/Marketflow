// lib/generateMarketNarration.ts
// Market Health 감성 나레이션 생성기

export interface HealthInput {
  totalScore: number;
  trend:      { score: number; label: string; conf: number };
  volatility: { score: number; label: string; conf: number };
  breadth:    { score: number; label: string; conf: number };
  liquidity:  { score: number; label: string; conf: number };
}

export interface NarrationOutput {
  hero: string;
  totalNarration: string;
  trendNarration: string;
  volatilityNarration: string;
  breadthNarration: string;
  liquidityNarration: string;
  closingAdvice: string;
}

function buildNarrationPrompt(input: HealthInput): { totalLabel: string; userPrompt: string } {
  const totalLabel = getTotalLabel(input.totalScore);
  const userPrompt = `
다음 시장 건강도 데이터를 기반으로 각 항목의 나레이션을 생성해주세요.

## 입력 데이터
- 총점: ${input.totalScore}/100 (상태: ${totalLabel})
- 추세 정렬도: ${input.trend.score}/25 (${input.trend.label}, 신뢰도 ${input.trend.conf}%)
- 변동성 안정성: ${input.volatility.score}/25 (${input.volatility.label}, 신뢰도 ${input.volatility.conf}%)
- 시장 확산 강도: ${input.breadth.score}/25 (${input.breadth.label}, 신뢰도 ${input.breadth.conf}%)
- 유동성 상태: ${input.liquidity.score}/25 (${input.liquidity.label}, 신뢰도 ${input.liquidity.conf}%)

## 출력 규칙
- 순수 JSON만 반환. 마크다운 없이.
- hero: 15자 이내 임팩트 한 줄
- totalNarration: 2–3문장, 감성적이고 따뜻하게
- 각 지표 나레이션: 1–2문장, 일상 비유 사용 (날씨/계절/호흡/심장박동)
- closingAdvice: 2문장, 따뜻하고 실용적인 행동 방향

{
  "hero": "",
  "totalNarration": "",
  "trendNarration": "",
  "volatilityNarration": "",
  "breadthNarration": "",
  "liquidityNarration": "",
  "closingAdvice": ""
}

## 현재 톤: "${totalLabel}" 구간
- 양호(55–74): 희망적이지만 균형 잡힌 톤. 조심하되 과도한 불안 없이.
`;
  return { totalLabel, userPrompt };
}

function parseNarrationJson(text: string): NarrationOutput {
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean) as NarrationOutput;
}

async function callAnthropicNarration(userPrompt: string): Promise<NarrationOutput> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? "";
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      system: `당신은 따뜻하고 감성적인 한국어 시장 분석가입니다.
소매 투자자를 위해 씁니다. 일상적인 비유를 사용하세요.
전문 용어는 즉시 쉬운 말로 설명하세요.
항상 차분하고 행동 가능한 방향으로 마무리하세요.
순수 JSON만 반환하고 마크다운 코드블록은 절대 사용하지 마세요.`,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) throw new Error(`Anthropic API ${response.status}`);
  const data = await response.json();
  const text: string | undefined = data?.content?.[0]?.text;
  if (!text) throw new Error("Anthropic empty response");
  return parseNarrationJson(text);
}

async function callGeminiNarration(userPrompt: string): Promise<NarrationOutput> {
  const apiKey =
    process.env.GEMINI_API_KEY ??
    process.env.GOOGLE_API_KEY ??
    "";
  if (!apiKey) throw new Error("GEMINI_API_KEY/GOOGLE_API_KEY missing");

  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generationConfig: {
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 1200,
        responseMimeType: "application/json",
      },
      systemInstruction: {
        parts: [
          {
            text: `당신은 따뜻하고 감성적인 한국어 시장 분석가입니다.
소매 투자자를 위해 씁니다. 일상적인 비유를 사용하세요.
전문 용어는 즉시 쉬운 말로 설명하세요.
항상 차분하고 행동 가능한 방향으로 마무리하세요.
순수 JSON만 반환하세요.`,
          },
        ],
      },
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    }),
  });

  if (!response.ok) throw new Error(`Gemini API ${response.status}`);
  const data = await response.json();
  const text: string | undefined =
    data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join("").trim();
  if (!text) throw new Error("Gemini empty response");
  return parseNarrationJson(text);
}

function getTotalLabel(score: number): string {
  if (score >= 75) return "건강";
  if (score >= 55) return "양호";
  if (score >= 40) return "중립";
  if (score >= 20) return "경계";
  return "위험";
}

export async function generateMarketNarration(
  input: HealthInput
): Promise<NarrationOutput> {
  const { userPrompt } = buildNarrationPrompt(input);

  try {
    return await callAnthropicNarration(userPrompt);
  } catch (anthropicErr) {
    console.error("Anthropic narration failed, trying Gemini:", anthropicErr);
  }

  try {
    return await callGeminiNarration(userPrompt);
  } catch (geminiErr) {
    console.error("Gemini narration failed, using fallback:", geminiErr);
    return getFallbackNarration(input);
  }
}

// ─────────────────────────────────────────────
// 폴백: API 없이 정적 매핑으로 즉시 반환
// ─────────────────────────────────────────────
const TOTAL_MAP: Record<string, { hero: string; narration: string; advice: string }> = {
  건강: {
    hero: "시장이 힘차게 달리고 있습니다",
    narration: "시장이 자신 있게 앞으로 나아가고 있습니다. 추세·확산·유동성이 모두 한 방향을 가리키는 드문 순간이에요. 지금은 흐름에 올라탈 최적의 타이밍입니다.",
    advice: "자신감을 갖되 리스크 관리는 잊지 마세요. 흐름이 살아있는 동안 수익을 차곡차곡 쌓아가세요.",
  },
  양호: {
    hero: "시장은 숨 고르는 중",
    narration: "시장이 앞으로 가고 싶은 마음은 있지만, 아직 발걸음이 가볍지 않습니다. '괜찮다'와 '조심해' 사이 어딘가에 서 있는 형국이에요. 크게 베팅하기보다, 자리를 지키며 다음 신호를 기다리는 시간입니다.",
    advice: "지금은 '얼마나 벌까'보다 '얼마나 지킬까'를 먼저 생각하세요. 노출 범위를 유지하며 흐름이 정렬될 때를 차분히 기다려보세요.",
  },
  중립: {
    hero: "시장이 아직 마음을 정하지 못했습니다",
    narration: "시장은 지금 '예스'도 '노'도 아닌 대답을 하고 있습니다. 흐름이 확인되기 전까지는 크게 움직이기보다 포지션을 가볍게 유지하며 다음 국면을 준비하는 것이 가장 합리적입니다.",
    advice: "포지션을 줄이고 현금을 쌓아둘 타이밍입니다. 구조가 정렬될 때까지 서두르지 않는 것이 최선입니다.",
  },
  경계: {
    hero: "조용히 지키는 것이 이기는 법",
    narration: "흔들림이 감지됩니다. 시장이 방향을 잃고 있어요. 지금은 공격보다 수비가 훨씬 현명한 선택입니다.",
    advice: "현금 비중을 높이고 레버리지를 낮추세요. 반등을 쫓기보다 자산을 지키는 데 집중하세요.",
  },
  위험: {
    hero: "지금은 지키는 것이 전부입니다",
    narration: "시장 구조가 무너지는 신호가 보입니다. 수익을 추구할 때가 아니라 손실을 최소화할 때입니다.",
    advice: "현금이 최고의 자산입니다. 반등 신호가 명확해질 때까지 시장 밖에서 기다리세요.",
  },
};

const TREND_MAP: Record<string, string> = {
  Bullish:    "추세의 나침반이 한 방향을 힘차게 가리키고 있습니다. 흐름에 올라탈 여건이 갖춰졌어요.",
  Good:       "추세는 살아있지만 아직 힘을 모으는 중입니다. 조금 더 기다리면 방향이 선명해질 거예요.",
  Mixed:      "추세의 나침반이 흔들리고 있습니다. 방향을 잃은 건 아니지만, 확신하기엔 이릅니다.",
  Weak:       "추세가 방향을 잃었습니다. 역방향 포지션보다는 관망이 현명한 선택입니다.",
  "Very Weak":"추세 구조가 크게 훼손되었습니다. 섣부른 진입보다 관망이 최선입니다.",
};

const VOLATILITY_MAP: Record<string, string> = {
  Stable:   "시장의 숨결이 고르고 평온합니다. 포지션을 여유 있게 운영할 수 있는 구간이에요.",
  Normal:   "약간의 출렁임이 있지만 충분히 감당할 수준입니다. 긴장하지 않아도 됩니다.",
  Caution:  "시장의 숨결이 조금 가빠졌습니다. 포지션 크기를 한 번 점검해볼 때입니다.",
  Unstable: "시장이 격하게 흔들리고 있습니다. 레버리지와 과도한 집중 포지션은 당장 줄이세요.",
  Danger:   "변동성이 위험 수준입니다. 현금 비중을 즉시 높이고 수비 태세로 전환하세요.",
};

const BREADTH_MAP: Record<string, string> = {
  "Strong Breadth": "대부분의 종목이 함께 오르는 건강한 랠리입니다. 시장 전반에 걸쳐 기회가 열려 있어요.",
  "Normal Breadth": "일부 섹터가 상승을 주도하고 있습니다. 주도 업종 중심의 선별적 접근이 유효합니다.",
  Narrow:           "오르는 종목이 많지 않습니다. 소수에 집중된 랠리는 언제든 꺼질 수 있어요.",
  "Very Narrow":    "랠리의 폭이 매우 좁습니다. 지수가 올라도 내 종목이 안 오를 수 있는 구간입니다.",
  Breakdown:        "시장 확산이 크게 무너졌습니다. 개별 종목 선별보다 현금 보유가 우선입니다.",
};

const LIQUIDITY_MAP: Record<string, string> = {
  Abundant: "자금이 시장에 넘치고 있습니다. 유동성이 뒷받침되는 상승은 훨씬 더 힘이 세요.",
  Normal:   "유동성은 있지만 여유롭지는 않습니다. 급격한 포지션 변화보다 점진적 조정이 좋습니다.",
  Tight:    "자금의 흐름이 좁아졌습니다. 무리한 매수보다 현 수준을 지키는 게 우선입니다.",
  Danger:   "유동성이 빠르게 말라가고 있습니다. 현금 비중을 높이고 방어 자세를 취하세요.",
  Frozen:   "유동성이 경색 상태입니다. 시장에서 한발 물러서 안전을 최우선으로 하세요.",
};

function getFallbackNarration(input: HealthInput): NarrationOutput {
  const label = getTotalLabel(input.totalScore);
  const total = TOTAL_MAP[label] ?? TOTAL_MAP["중립"];
  return {
    hero: total.hero,
    totalNarration: total.narration,
    trendNarration:
      TREND_MAP[input.trend.label] ??
      `추세 정렬도 ${input.trend.score}/25 — ${input.trend.label}`,
    volatilityNarration:
      VOLATILITY_MAP[input.volatility.label] ??
      `변동성 안정성 ${input.volatility.score}/25 — ${input.volatility.label}`,
    breadthNarration:
      BREADTH_MAP[input.breadth.label] ??
      `시장 확산 강도 ${input.breadth.score}/25 — ${input.breadth.label}`,
    liquidityNarration:
      LIQUIDITY_MAP[input.liquidity.label] ??
      `유동성 상태 ${input.liquidity.score}/25 — ${input.liquidity.label}`,
    closingAdvice: total.advice,
  };
}
