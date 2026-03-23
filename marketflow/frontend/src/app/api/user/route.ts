import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { getUserById } from '@/lib/db/userDb'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ user: null }, { status: 200 })
  }
  const id = (session.user as any).id
  const dbUser = getUserById(id)
  if (!dbUser) return NextResponse.json({ user: null }, { status: 200 })
  return NextResponse.json({
    user: {
      id:    dbUser.id,
      email: dbUser.email,
      plan:  dbUser.plan,
    }
  })
}
