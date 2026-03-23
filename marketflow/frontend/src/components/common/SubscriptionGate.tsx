// =============================================================================
// SubscriptionGate.tsx  (WO-SA23)
// Wraps premium-only content. Blurs children when locked.
// =============================================================================
import { type ReactNode } from 'react'
import { DEV_UNLOCK_ALL } from '@/config/dev'
import PremiumLockCard from './PremiumLockCard'

interface Props {
  isPremium: boolean
  title:     string
  children:  ReactNode
}

export default function SubscriptionGate({ isPremium, title, children }: Props) {
  if (DEV_UNLOCK_ALL || isPremium) return <>{children}</>
  return (
    <div style={{ position: 'relative', borderRadius: 16 }}>
      <div style={{ filter: 'blur(3px)', opacity: 0.35, pointerEvents: 'none', userSelect: 'none' }} aria-hidden="true">
        {children}
      </div>
      <PremiumLockCard title={title} />
    </div>
  )
}
