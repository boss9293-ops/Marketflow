'use client'

import { useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import LoginModal from '@/components/auth/LoginModal'
import UpgradeButton from '@/components/subscription/UpgradeButton'

export default function UserPlanBadge() {
  const { user, isPremium, isLoggedIn, isLoading, logout } = useAuth()
  const [showLogin,  setShowLogin]  = useState(false)
  const [showMenu,   setShowMenu]   = useState(false)

  if (isLoading) return null

  if (!isLoggedIn) {
    return (
      <>
        <button
          onClick={() => setShowLogin(true)}
          style={{
            background:   'rgba(255,255,255,0.06)',
            border:       '1px solid rgba(255,255,255,0.12)',
            color:        '#94A3B8',
            borderRadius: 8,
            padding:      '5px 12px',
            fontSize:     '0.74rem',
            fontWeight:   600,
            cursor:       'pointer',
          }}
        >
          Sign In
        </button>
        <LoginModal open={showLogin} onClose={() => setShowLogin(false)} />
      </>
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setShowMenu(v => !v)}
        style={{
          display:      'flex',
          alignItems:   'center',
          gap:          6,
          background:   isPremium ? 'rgba(215,255,55,0.08)' : 'rgba(255,255,255,0.05)',
          border:       `1px solid ${isPremium ? 'rgba(215,255,55,0.30)' : 'rgba(255,255,255,0.10)'}`,
          borderRadius: 8,
          padding:      '5px 10px',
          cursor:       'pointer',
        }}
      >
        <span style={{
          fontSize:     '0.65rem',
          fontWeight:   800,
          color:        isPremium ? '#D7FF37' : '#64748B',
          letterSpacing: '0.06em',
        }}>
          {isPremium ? 'PREMIUM' : 'FREE'}
        </span>
        <span style={{ color: '#94A3B8', fontSize: '0.70rem', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {user?.email}
        </span>
      </button>

      {showMenu && (
        <div
          style={{
            position:   'absolute',
            top:        '110%',
            right:      0,
            background: '#0E1420',
            border:     '1px solid rgba(255,255,255,0.10)',
            borderRadius: 10,
            padding:    '0.5rem',
            minWidth:   160,
            zIndex:     100,
          }}
        >
          {!isPremium && (
            <div style={{ padding: '4px 6px', marginBottom: 4 }}>
              <UpgradeButton compact />
            </div>
          )}
          {isPremium && (
            <button
              onClick={async () => {
                const res = await fetch('/api/stripe/portal', { method: 'POST' })
                const data = await res.json()
                if (data.url) window.location.href = data.url
                setShowMenu(false)
              }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                background: 'none', border: 'none', color: '#94A3B8',
                fontSize: '0.72rem', padding: '6px 8px', cursor: 'pointer', borderRadius: 6,
              }}
            >
              Manage Subscription
            </button>
          )}
          <button
            onClick={() => { logout(); setShowMenu(false) }}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              background: 'none', border: 'none', color: '#94A3B8',
              fontSize: '0.72rem', padding: '6px 8px', cursor: 'pointer', borderRadius: 6,
            }}
          >
            Sign Out
          </button>
        </div>
      )}
    </div>
  )
}
