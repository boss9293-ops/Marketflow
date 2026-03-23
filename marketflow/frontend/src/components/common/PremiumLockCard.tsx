'use client'

import UpgradeButton from '@/components/subscription/UpgradeButton'
import { DEV_UNLOCK_ALL } from '@/config/dev'

interface Props {
  compact?: boolean
  title?: string
  description?: string
}

export default function PremiumLockCard({ compact = false, title, description }: Props) {
  if (DEV_UNLOCK_ALL) return null
  if (compact) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px',
        background: 'rgba(215,255,55,0.04)',
        border: '1px solid rgba(215,255,55,0.12)',
        borderRadius: 8,
      }}>
        <span style={{ color: '#D7FF37', fontSize: '0.72rem', fontWeight: 700 }}>PREMIUM</span>
        <span style={{ color: '#64748B', fontSize: '0.72rem', flex: 1 }}>{title ?? 'Premium feature'}</span>
        <UpgradeButton compact label="Unlock" />
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: '1rem', padding: '2.5rem 2rem', textAlign: 'center',
      background: 'rgba(215,255,55,0.03)',
      border: '1px solid rgba(215,255,55,0.10)',
      borderRadius: 16,
    }}>
      <div style={{ fontSize: '1.8rem' }}>&#x1F512;</div>
      <div style={{ color: '#E2E8F0', fontSize: '0.95rem', fontWeight: 700 }}>
        {title ?? 'Premium Feature'}
      </div>
      {description && (
        <div style={{ color: '#64748B', fontSize: '0.80rem', lineHeight: 1.6, maxWidth: 320 }}>
          {description}
        </div>
      )}
      <UpgradeButton label="Unlock deeper insight" />
    </div>
  )
}
