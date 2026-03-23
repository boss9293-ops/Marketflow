'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'

export default function UpgradeSuccessPage() {
  const { update } = useSession()
  const [done, setDone] = useState(false)

  useEffect(() => {
    // Refresh session so JWT re-reads plan from DB
    update().then(() => setDone(true))
  }, [update])

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#070B10',
    }}>
      <div style={{
        background: '#0E1420', border: '1px solid rgba(215,255,55,0.20)',
        borderRadius: 20, padding: '3rem 2.5rem', maxWidth: 440, width: '100%', textAlign: 'center',
      }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>&#x1F389;</div>
        <div style={{ color: '#D7FF37', fontSize: '1.15rem', fontWeight: 800, marginBottom: '0.5rem' }}>
          Premium Unlocked
        </div>
        <div style={{ color: '#94A3B8', fontSize: '0.82rem', marginBottom: '2rem', lineHeight: 1.6 }}>
          Your account has been upgraded to Premium. All features are now available.
        </div>
        <Link href="/dashboard">
          <button style={{
            background: '#D7FF37', color: '#0B0F14', fontWeight: 800,
            fontSize: '0.82rem', border: 'none', borderRadius: 8,
            padding: '0.65rem 2rem', cursor: 'pointer',
          }}>
            Go to Dashboard
          </button>
        </Link>
      </div>
    </div>
  )
}
