import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { getUserById } from '@/lib/db/userDb'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ plan: 'FREE' })
  }
  const id = (session.user as any).id
  const dbUser = getUserById(id)
  return NextResponse.json({ plan: dbUser?.plan ?? 'FREE' })
}
