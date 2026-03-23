'use client'
// =============================================================================
// UpgradeButton.tsx  (WO-SA24)
//
// Stripe Checkout redirect button.
// Not-logged-in → redirect to sign-in (modal trigger or /api/auth/signin)
// Free user     → POST /api/stripe/checkout → redirect to Stripe
// Premium user  → POST /api/stripe/portal → redirect to Stripe billing portal
// =============================================================================

import { useState } from 'react'
import { useSession, signIn } from 'next-auth/react'

interface Props {
  label?:   string
  compact?: boolean
  style?:   React.CSSProperties
}

export default function UpgradeButton({ label, compact = false, style }: Props) {
  const { data: session, status } = useSession()
  const plan = (session?.user as any)?.plan ?? 'FREE'
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    if (status === 'unauthenticated') {
      signIn()
      return
    }

    setLoading(true)
    try {
      if (plan === 'PREMIUM') {
        // Open Stripe billing portal (cancel / manage)
        const res = await fetch('/api/stripe/portal', { method: 'POST' })
        const data = await res.json()
        if (data.url) window.location.href = data.url
      } else {
        // Start Stripe Checkout
        const res = await fetch('/api/stripe/checkout', { method: 'POST' })
        const data = await res.json()
        if (data.url) window.location.href = data.url
      }
    } finally {
      setLoading(false)
    }
  }

  const defaultLabel = plan === 'PREMIUM' ? 'Manage Plan' : (label ?? 'Upgrade to Premium')

  if (compact) {
    return (
      <button
        onClick={handleClick}
        disabled={loading}
        style={{
          borderRadius:  6,
          background:    '#D7FF37',
          color:         '#0B0F14',
          fontSize:      '0.62rem',
          fontWeight:    800,
          padding:       '3px 10px',
          letterSpacing: '0.04em',
          cursor:        loading ? 'wait' : 'pointer',
          border:        'none',
          flexShrink:    0,
          opacity:       loading ? 0.7 : 1,
          ...style,
        }}
        type="button"
      >
        {loading ? '...' : (plan === 'PREMIUM' ? 'Manage' : 'Unlock')}
      </button>
    )
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      style={{
        borderRadius:  8,
        background:    '#D7FF37',
        color:         '#0B0F14',
        fontSize:      '0.80rem',
        fontWeight:    800,
        padding:       '0.6rem 1.5rem',
        letterSpacing: '0.04em',
        cursor:        loading ? 'wait' : 'pointer',
        border:        'none',
        opacity:       loading ? 0.7 : 1,
        ...style,
      }}
      type="button"
    >
      {loading ? 'Redirecting…' : defaultLabel}
    </button>
  )
}
