import { NextResponse } from 'next/server'

import { ET_TIMEZONE, type AskQuestionRequest } from '@/lib/terminal-mvp/types'
import { insertEvidenceRows, insertNewsClusters, insertQaSession } from '@/lib/terminal-mvp/qaEvidenceDb'
import { runAskResearchPipeline } from '@/lib/terminal-mvp/qaResearchEngine'

export const runtime = 'nodejs'

const isDateET = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value)

export async function POST(req: Request) {
  let payload: AskQuestionRequest
  try {
    payload = (await req.json()) as AskQuestionRequest
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload.' }, { status: 400 })
  }

  const symbol = payload.symbol?.trim().toUpperCase()
  const question = payload.question?.trim()
  const dateET = payload.dateET

  if (!symbol || !/^[A-Z.\-]{1,10}$/.test(symbol)) {
    return NextResponse.json({ error: 'Invalid symbol.' }, { status: 400 })
  }
  if (!question) {
    return NextResponse.json({ error: 'Question is required.' }, { status: 400 })
  }
  if (!dateET || !isDateET(dateET)) {
    return NextResponse.json({ error: 'Invalid ET date.' }, { status: 400 })
  }
  if (payload.timezone !== ET_TIMEZONE) {
    return NextResponse.json({ error: `Timezone must be ${ET_TIMEZONE}.` }, { status: 400 })
  }

  try {
    const result = await runAskResearchPipeline({
      symbol,
      dateET,
      question,
    })

    insertQaSession({
      sessionId: result.sessionId,
      symbol,
      dateET,
      question,
      questionType: result.questionType,
      answerKo: result.answerKo,
    })
    insertEvidenceRows(result.evidenceRows)
    insertNewsClusters(
      result.newsClusters.map((cluster) => ({
        ...cluster,
        sessionId: result.sessionId,
      })),
      result.newsClusterItems.map((item) => ({
        ...item,
        sessionId: result.sessionId,
      })),
    )

    return NextResponse.json({
      data: {
        sessionId: result.sessionId,
        symbol,
        dateET,
        question,
        questionType: result.questionType,
        answerKo: result.answerKo,
      },
      meta: {
        timezone: ET_TIMEZONE,
        dateET,
      },
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to create research session.',
      },
      { status: 500 },
    )
  }
}
