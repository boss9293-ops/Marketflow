'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'

interface Props {
  open:    boolean
  onClose: () => void
  defaultMode?: 'login' | 'signup'
}

export default function LoginModal({ open, onClose, defaultMode = 'login' }: Props) {
  const [mode,     setMode]     = useState<'login' | 'signup'>(defaultMode)
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  if (!open) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await signIn('credentials', {
        email,
        password,
        mode,
        redirect: false,
      })
      if (res?.error) {
        if (res.error === 'EMAIL_EXISTS')    setError('Email already registered. Please log in.')
        else if (res.error === 'USER_NOT_FOUND') setError('Email not found. Please sign up.')
        else if (res.error === 'WRONG_PASSWORD')  setError('Incorrect password.')
        else setError('Authentication failed. Please try again.')
      } else {
        onClose()
        window.location.reload()
      }
    } catch {
      setError('Something went wrong.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        position:  'fixed', inset: 0, zIndex: 200,
        background: 'rgba(7,11,16,0.85)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background:   '#0E1420',
          border:       '1px solid rgba(255,255,255,0.10)',
          borderRadius: 16,
          padding:      '2rem',
          width:        '100%',
          maxWidth:     380,
        }}
      >
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: '1.5rem', background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 3 }}>
          {(['login', 'signup'] as const).map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); setError('') }}
              style={{
                flex: 1, padding: '6px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: mode === m ? 'rgba(255,255,255,0.10)' : 'transparent',
                color: mode === m ? '#E2E8F0' : '#64748B',
                fontSize: '0.78rem', fontWeight: 700,
              }}
            >
              {m === 'login' ? 'Sign In' : 'Sign Up'}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: 8, padding: '0.6rem 0.9rem', color: '#E2E8F0', fontSize: '0.82rem',
              outline: 'none', width: '100%',
            }}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={6}
            style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)',
              borderRadius: 8, padding: '0.6rem 0.9rem', color: '#E2E8F0', fontSize: '0.82rem',
              outline: 'none', width: '100%',
            }}
          />
          {error && (
            <div style={{ color: '#F87171', fontSize: '0.72rem', background: 'rgba(248,113,113,0.08)', borderRadius: 6, padding: '6px 10px' }}>
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            style={{
              background: '#D7FF37', color: '#0B0F14', fontWeight: 800, fontSize: '0.82rem',
              border: 'none', borderRadius: 8, padding: '0.65rem', cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Processing\u2026' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  )
}
