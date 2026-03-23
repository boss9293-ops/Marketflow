import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { getUserById } from '@/lib/db/userDb'
import { getStripe } from '@/lib/stripe'

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const id = (session.user as any).id
  const dbUser = getUserById(id)
  if (!dbUser?.stripe_customer_id) {
    return NextResponse.json({ error: 'No subscription found' }, { status: 400 })
  }

  const origin = process.env.NEXTAUTH_URL ?? 'http://localhost:3010'
  const portalSession = await getStripe().billingPortal.sessions.create({
    customer:   dbUser.stripe_customer_id,
    return_url: `${origin}/dashboard`,
  })
  return NextResponse.json({ url: portalSession.url })
}
