/**
 * Turso (libSQL) 서버사이드 클라이언트 헬퍼
 * - 서버 컴포넌트 / Route Handler 전용 (클라이언트 번들에 포함되지 않음)
 * - 환경변수: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
 */

import { createClient, type Client } from '@libsql/client'

let _client: Client | null = null

export function getTursoClient(): Client | null {
  if (_client) return _client

  const url = (
    process.env.TURSO_DATABASE_URL ||
    process.env.LIBSQL_URL ||
    'libsql://marketos-boss9293.aws-us-east-1.turso.io'
  ).trim()

  const authToken = (
    process.env.TURSO_AUTH_TOKEN ||
    process.env.LIBSQL_AUTH_TOKEN ||
    ''
  ).trim()

  if (!authToken) {
    console.warn('[Turso] TURSO_AUTH_TOKEN not set — Turso queries will be skipped.')
    return null
  }

  try {
    _client = createClient({ url, authToken })
    return _client
  } catch (err) {
    console.error('[Turso] Failed to create client:', err)
    return null
  }
}
