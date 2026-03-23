'use client'

import { useState } from 'react'
import { DEV_UNLOCK_ALL } from '@/config/dev'
import { useAuth } from '@/contexts/AuthContext'
import LoginModal from '@/components/auth/LoginModal'

interface Props {
  label?:   string
  compact?: boolean
}

export default function UpgradeButton({ label = 'Upgrade to Premium', compact = false }: Props) {
  const { isLoggedIn, isPremium } = useAuth()
  const [showLogin,   setShowLogin]   = useState(false)
  const [loading,     setLoading]     = useState(false)

  if (DEV_UNLOCK_ALL || isPremium) return null

  async function handleClick() {
    if (!isLoggedIn) {
      setShowLogin(true)
      return
    }
    setLoading(true)
    try {
      const res  = await fetch('/api/stripe/checkout', { method: 'POST' })
      const data = await res.json()
      if (data.url) window.location.href = data.url
      else alert(data.error ?? 'Unable to start checkout')
    } catch {
      alert('Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <button
        onClick={handleClick}
        disabled={loading}
        style={{
          background:    '#D7FF37',
          color:         '#0B0F14',
          fontWeight:    800,
          fontSize:      compact ? '0.68rem' : '0.78rem',
          border:        'none',
          borderRadius:  compact ? 6 : 8,
          padding:       compact ? '4px 12px' : '7px 18px',
          cursor:        loading ? 'not-allowed' : 'pointer',
          opacity:       loading ? 0.7 : 1,
          letterSpacing: '0.03em',
          whiteSpace:    'nowrap',
        }}
      >
        {loading ? 'Loading\u2026' : label}
      </button>
      <LoginModal open={showLogin} onClose={() => setShowLogin(false)} defaultMode="signup" />
    </>
  )
}
