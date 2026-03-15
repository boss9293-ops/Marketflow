import fs from 'fs'
import path from 'path'

import Database from 'better-sqlite3'

import type {
  ETDateString,
  EvidenceRow,
  NewsClusterItemRecord,
  NewsClusterRecord,
  QAQuestionType,
} from '@/lib/terminal-mvp/types'

type QaSessionRecord = {
  sessionId: string
  symbol: string
  dateET: ETDateString
  question: string
  questionType: QAQuestionType
  answerKo: string
}

type QueueEvidenceSheetExportInput = {
  sessionId: string
  sheetName: string
  requestedBy: string
  requestedAtET: string
  rowCount: number
}

const DB_PATH = path.resolve(process.cwd(), 'data', 'terminal_mvp_research.db')

let db: any | null = null

function getDb() {
  if (db) return db
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS qa_sessions (
      session_id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      date_et TEXT NOT NULL,
      question TEXT NOT NULL,
      question_type TEXT NOT NULL,
      answer_ko TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS evidence_rows (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      date_et TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      summary TEXT NOT NULL,
      published_at_et TEXT NOT NULL,
      published_at_ts INTEGER NOT NULL,
      ai_relevancy REAL NOT NULL,
      url TEXT,
      created_at_et TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES qa_sessions(session_id)
    );

    CREATE INDEX IF NOT EXISTS idx_evidence_rows_session ON evidence_rows(session_id);
    CREATE INDEX IF NOT EXISTS idx_evidence_rows_relevancy ON evidence_rows(session_id, ai_relevancy DESC);
    CREATE INDEX IF NOT EXISTS idx_evidence_rows_recent ON evidence_rows(session_id, published_at_ts DESC);

    CREATE TABLE IF NOT EXISTS evidence_export_jobs (
      job_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      sheet_name TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      requested_at_et TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_evidence_export_jobs_session ON evidence_export_jobs(session_id);

    CREATE TABLE IF NOT EXISTS news_clusters (
      cluster_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      date_et TEXT NOT NULL,
      representative_news_id TEXT NOT NULL,
      representative_title TEXT NOT NULL,
      representative_source TEXT NOT NULL,
      representative_summary TEXT NOT NULL,
      representative_published_at_et TEXT NOT NULL,
      representative_url TEXT,
      related_article_count INTEGER NOT NULL,
      importance_score REAL NOT NULL,
      event_tags_json TEXT NOT NULL,
      created_at_et TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_news_clusters_session ON news_clusters(session_id);
    CREATE INDEX IF NOT EXISTS idx_news_clusters_importance ON news_clusters(session_id, importance_score DESC);

    CREATE TABLE IF NOT EXISTS news_cluster_items (
      id TEXT PRIMARY KEY,
      cluster_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      news_id TEXT NOT NULL,
      headline TEXT NOT NULL,
      source TEXT NOT NULL,
      published_at_et TEXT NOT NULL,
      url TEXT,
      canonical_url TEXT NOT NULL,
      normalized_title TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      is_representative INTEGER NOT NULL,
      duplicate_count INTEGER NOT NULL,
      created_at_et TEXT NOT NULL,
      FOREIGN KEY(cluster_id) REFERENCES news_clusters(cluster_id)
    );

    CREATE INDEX IF NOT EXISTS idx_news_cluster_items_cluster ON news_cluster_items(cluster_id);
    CREATE INDEX IF NOT EXISTS idx_news_cluster_items_session ON news_cluster_items(session_id);
  `)
  return db
}

export function insertQaSession(record: QaSessionRecord) {
  const database = getDb()
  database
    .prepare(`
      INSERT OR REPLACE INTO qa_sessions (
        session_id, symbol, date_et, question, question_type, answer_ko
      ) VALUES (
        @sessionId, @symbol, @dateET, @question, @questionType, @answerKo
      )
    `)
    .run(record)
}

export function insertEvidenceRows(rows: EvidenceRow[]) {
  if (!rows.length) return
  const database = getDb()
  const stmt = database.prepare(`
    INSERT OR REPLACE INTO evidence_rows (
      id, session_id, symbol, date_et, source_type, source_id, title, source, summary,
      published_at_et, published_at_ts, ai_relevancy, url, created_at_et
    ) VALUES (
      @id, @sessionId, @symbol, @dateET, @sourceType, @sourceId, @title, @source, @summary,
      @publishedAtET, @publishedAtTs, @aiRelevancy, @url, @createdAtET
    )
  `)
  const tx = database.transaction((payload: EvidenceRow[]) => {
    for (const row of payload) {
      stmt.run(row)
    }
  })
  tx(rows)
}

export function fetchEvidenceRows(sessionId: string): EvidenceRow[] {
  const database = getDb()
  return database
    .prepare(`
      SELECT
        id,
        session_id AS sessionId,
        symbol,
        date_et AS dateET,
        source_type AS sourceType,
        source_id AS sourceId,
        title,
        source,
        summary,
        published_at_et AS publishedAtET,
        published_at_ts AS publishedAtTs,
        ai_relevancy AS aiRelevancy,
        url,
        created_at_et AS createdAtET
      FROM evidence_rows
      WHERE session_id = ?
      ORDER BY ai_relevancy DESC, published_at_ts DESC
    `)
    .all(sessionId) as EvidenceRow[]
}

export function insertNewsClusters(
  clusters: NewsClusterRecord[],
  clusterItems: NewsClusterItemRecord[],
) {
  if (!clusters.length && !clusterItems.length) return
  const database = getDb()

  const clusterStmt = database.prepare(`
    INSERT OR REPLACE INTO news_clusters (
      cluster_id, session_id, symbol, date_et, representative_news_id,
      representative_title, representative_source, representative_summary,
      representative_published_at_et, representative_url, related_article_count,
      importance_score, event_tags_json, created_at_et
    ) VALUES (
      @clusterId, @sessionId, @symbol, @dateET, @representativeNewsId,
      @representativeTitle, @representativeSource, @representativeSummary,
      @representativePublishedAtET, @representativeUrl, @relatedArticleCount,
      @importanceScore, @eventTagsJson, @createdAtET
    )
  `)

  const itemStmt = database.prepare(`
    INSERT OR REPLACE INTO news_cluster_items (
      id, cluster_id, session_id, news_id, headline, source, published_at_et,
      url, canonical_url, normalized_title, tags_json, is_representative,
      duplicate_count, created_at_et
    ) VALUES (
      @clusterItemId, @clusterId, @sessionId, @newsId, @headline, @source, @publishedAtET,
      @url, @canonicalUrl, @normalizedTitle, @tagsJson, @isRepresentative,
      @duplicateCount, @createdAtET
    )
  `)

  const tx = database.transaction(
    (clusterPayload: NewsClusterRecord[], itemPayload: NewsClusterItemRecord[]) => {
      for (const cluster of clusterPayload) {
        clusterStmt.run({
          ...cluster,
          eventTagsJson: JSON.stringify(cluster.eventTags ?? []),
        })
      }
      for (const item of itemPayload) {
        itemStmt.run({
          ...item,
          tagsJson: JSON.stringify(item.tags ?? []),
          isRepresentative: item.isRepresentative ? 1 : 0,
        })
      }
    },
  )

  tx(clusters, clusterItems)
}

export function queueEvidenceSheetExport(input: QueueEvidenceSheetExportInput): string {
  const database = getDb()
  const jobId = `evexp-${input.sessionId}-${Date.now()}`
  database
    .prepare(`
      INSERT INTO evidence_export_jobs (
        job_id, session_id, sheet_name, requested_by, requested_at_et, row_count, status
      ) VALUES (
        @jobId, @sessionId, @sheetName, @requestedBy, @requestedAtET, @rowCount, 'queued'
      )
    `)
    .run({
      jobId,
      sessionId: input.sessionId,
      sheetName: input.sheetName,
      requestedBy: input.requestedBy,
      requestedAtET: input.requestedAtET,
      rowCount: input.rowCount,
    })
  return jobId
}
