// =============================================================================
// auth.ts — NextAuth v4 configuration
// =============================================================================
import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import { getUserByEmail, createUser, getUserById } from '@/lib/db/userDb'

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/',   // we use modal; redirect back to home if forced
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email:    { label: 'Email',    type: 'email' },
        password: { label: 'Password', type: 'password' },
        mode:     { label: 'Mode',     type: 'text' },  // 'login' | 'signup'
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null
        const email = credentials.email.toLowerCase().trim()
        const { password, mode } = credentials

        if (mode === 'signup') {
          // Check if email already exists
          const existing = getUserByEmail(email)
          if (existing) throw new Error('EMAIL_EXISTS')
          const hash = await bcrypt.hash(password, 10)
          const id = randomUUID()
          const user = createUser(id, email, hash)
          return { id: user.id, email: user.email, plan: user.plan }
        } else {
          // Login
          const user = getUserByEmail(email)
          if (!user) throw new Error('USER_NOT_FOUND')
          const valid = await bcrypt.compare(password, user.password_hash)
          if (!valid) throw new Error('WRONG_PASSWORD')
          return { id: user.id, email: user.email, plan: user.plan }
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id   = user.id
        token.plan = (user as any).plan ?? 'FREE'
      }
      // On session update (e.g. after Stripe webhook → refresh)
      if (trigger === 'update' && session?.plan) {
        token.plan = session.plan
      }
      // Always re-fetch plan from DB to stay fresh
      if (token.id) {
        const dbUser = getUserById(token.id as string)
        if (dbUser) token.plan = dbUser.plan
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id   = token.id
        ;(session.user as any).plan = token.plan ?? 'FREE'
      }
      return session
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
}
