// =============================================================================
// userDb.ts — SQLite user store (better-sqlite3)
// Tables: users
// =============================================================================
import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = path.join(process.cwd(), 'data', 'users.db')

export interface DbUser {
  id: string
  email: string
  password_hash: string
  plan: 'FREE' | 'PREMIUM'
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  created_at: string
}

function getDb() {
  const dir = path.dirname(DB_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const db = new Database(DB_PATH)
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id                    TEXT PRIMARY KEY,
      email                 TEXT UNIQUE NOT NULL,
      password_hash         TEXT NOT NULL,
      plan                  TEXT NOT NULL DEFAULT 'FREE',
      stripe_customer_id    TEXT,
      stripe_subscription_id TEXT,
      created_at            TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  return db
}

export function getUserByEmail(email: string): DbUser | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) as DbUser | undefined
}

export function getUserById(id: string): DbUser | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as DbUser | undefined
}

export function createUser(id: string, email: string, passwordHash: string): DbUser {
  const db = getDb()
  db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(id, email, passwordHash)
  return getUserById(id)!
}

export function updateUserPlan(id: string, plan: 'FREE' | 'PREMIUM'): void {
  const db = getDb()
  db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, id)
}

export function updateStripeInfo(id: string, customerId: string, subscriptionId?: string | null): void {
  const db = getDb()
  db.prepare('UPDATE users SET stripe_customer_id = ?, stripe_subscription_id = ? WHERE id = ?')
    .run(customerId, subscriptionId ?? null, id)
}

export function getUserByStripeCustomerId(customerId: string): DbUser | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM users WHERE stripe_customer_id = ?').get(customerId) as DbUser | undefined
}
