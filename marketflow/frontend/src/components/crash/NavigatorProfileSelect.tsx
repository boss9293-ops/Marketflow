'use client'

import { useRouter, useSearchParams } from 'next/navigation'

type ProfileOption = {
  key: string
  label: string
  description: string
}

type Props = {
  options: ProfileOption[]
  activeKey: string
}

export default function NavigatorProfileSelect({ options, activeKey }: Props) {
  const router = useRouter()
  const search = useSearchParams()

  const onChange = (value: string) => {
    const params = new URLSearchParams(search?.toString())
    params.set('profile', value)
    params.delete('w2')
    params.delete('w3')
    params.delete('d2')
    params.delete('d3')
    params.delete('p3')
    params.delete('admin')
    router.push(`/crash/navigator?${params.toString()}`)
  }

  return (
    <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center' }}>
      <label style={{ fontSize: '0.78rem', color: '#9ca3af' }}>Profile</label>
      <select
        value={activeKey}
        onChange={(e) => onChange(e.target.value)}
        style={{
          background: '#0f1116',
          color: '#e5e7eb',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 8,
          padding: '0.35rem 0.6rem',
          fontSize: '0.82rem',
        }}
      >
        {options.map((opt) => (
          <option key={opt.key} value={opt.key}>
            {opt.label}
          </option>
        ))}
      </select>
      <div style={{ fontSize: '0.74rem', color: '#7b8499' }}>
        {options.find((opt) => opt.key === activeKey)?.description}
      </div>
    </div>
  )
}
