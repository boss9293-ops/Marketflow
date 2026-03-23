import { NextRequest, NextResponse } from 'next/server'
import { getStripe, STRIPE_WEBHOOK_SECRET } from '@/lib/stripe'
import { getUserByStripeCustomerId, updateUserPlan, updateStripeInfo } from '@/lib/db/userDb'
import type Stripe from 'stripe'

export const config = { api: { bodyParser: false } }

export async function POST(req: NextRequest) {
  const body = await req.text()
  const sig  = req.headers.get('stripe-signature') ?? ''

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET)
  } catch (err: any) {
    console.error('Webhook signature error:', err.message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const customerId = session.customer as string
        const subscriptionId = session.subscription as string
        const user = getUserByStripeCustomerId(customerId)
        if (user) {
          updateStripeInfo(user.id, customerId, subscriptionId)
          updateUserPlan(user.id, 'PREMIUM')
        }
        break
      }
      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = invoice.customer as string
        const user = getUserByStripeCustomerId(customerId)
        if (user) updateUserPlan(user.id, 'PREMIUM')
        break
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const customerId = sub.customer as string
        const user = getUserByStripeCustomerId(customerId)
        if (user) {
          updateUserPlan(user.id, 'FREE')
          updateStripeInfo(user.id, customerId, null)
        }
        break
      }
    }
  } catch (err) {
    console.error('Webhook handler error:', err)
  }

  return NextResponse.json({ received: true })
}
