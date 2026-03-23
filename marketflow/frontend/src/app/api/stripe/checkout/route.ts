import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import { getUserById, updateStripeInfo } from '@/lib/db/userDb'
import { getStripe, STRIPE_PRICE_ID } from '@/lib/stripe'

export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const id = (session.user as any).id
  const dbUser = getUserById(id)
  if (!dbUser) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  if (dbUser.plan === 'PREMIUM') {
    return NextResponse.json({ error: 'Already premium' }, { status: 400 })
  }

  try {
    const stripe = getStripe()
    const origin = process.env.NEXTAUTH_URL ?? 'http://localhost:3010'

    // Create or reuse Stripe customer
    let customerId = dbUser.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({ email: dbUser.email, metadata: { userId: dbUser.id } })
      customerId = customer.id
      updateStripeInfo(dbUser.id, customerId)
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      customer:    customerId,
      mode:        'subscription',
      line_items:  [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${origin}/upgrade/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${origin}/dashboard`,
      metadata:    { userId: dbUser.id },
    })

    return NextResponse.json({ url: checkoutSession.url })
  } catch (err: any) {
    console.error('Stripe checkout error:', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
