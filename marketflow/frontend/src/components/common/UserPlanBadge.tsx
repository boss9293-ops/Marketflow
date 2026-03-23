'use client'
// =============================================================================
// UserPlanBadge.tsx  (WO-SA24)
//
// Top-right dashboard badge — shows login state + plan.
// FREE  → yellow [FREE] chip + Upgrade button
// PREMIUM → green [PREMIUM] chip
// Not logged in → [Sign In] button
// =============================================================================

import { useSession, signIn, signOut } from 'next-auth/react'
import UpgradeButton from './UpgradeButton'

export default function UserPlanBadge() {
  const { data: session, status } = useSession()

  if (status === 'loading') {
    return (
      <div style={{
        height: 28, width: 80, borderRadius: 6,
        background: 'rgba(255,255,255,0.05)',
        animation: 'pulse 1.5s ease-in-out infinite',
      }} />
    )
  }

  if (!session?.user) {
    return (
      <button
        onClick={() => signIn()}
        style={{
          borderRadius:  6,
          background:    'rgba(248,250,252,0.07)',
          border:        '1px solid rgba(248,250,252,0.13)',
          color:         '#94A3B8',
          fontSize:      '0.68rem',
          fontWeight:    700,
          padding:       '4px 12px',
          cursor:        'pointer',
          letterSpacing: '0.03em',
        }}
        type="button"
      >
        Sign In
      </button>
    )
  }

  const plan = (session.user as any).plan as 'FREE' | 'PREMIUM'

  if (plan === 'PREMIUM') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          borderRadius:  6,
          background:    'rgba(74,222,128,0.10)',
          border:        '1px solid rgba(74,222,128,0.25)',
          color:         '#4ADE80',
          fontSize:      '0.65rem',
          fontWeight:    800,
          padding:       '3px 9px',
          letterSpacing: '0.05em',
        }}>
          PREMIUM
        </span>
        <button
          onClick={() => signOut()}
          style={{
            background: 'transparent',
            border:     'none',
            color:      '#475569',
            fontSize:   '0.62rem',
            cursor:     'pointer',
            padding:    '2px 4px',
          }}
          type="button"
        >
          Sign out
        </button>
      </div>
    )
  }

  // FREE plan
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{
        borderRadius:  6,
        background:    'rgba(250,204,21,0.08)',
        border:        '1px solid rgba(250,204,21,0.22)',
        color:         '#FACC15',
        fontSize:      '0.65rem',
        fontWeight:    800,
        padding:       '3px 9px',
        letterSpacing: '0.05em',
      }}>
        FREE
      </span>
      <UpgradeButton compact />
      <button
        onClick={() => signOut()}
        style={{
          background: 'transparent',
          border:     'none',
          color:      '#475569',
          fontSize:   '0.62rem',
          cursor:     'pointer',
          padding:    '2px 4px',
        }}
        type="button"
      >
        Sign out
      </button>
    </div>
  )
}
