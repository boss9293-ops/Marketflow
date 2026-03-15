import Link from 'next/link'

export default function KRMarketAiHistoryPage() {
  return (
    <div style={{ padding: '3rem', color: '#9ca3af', textAlign: 'center' }}>
      <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#e5e7eb', marginBottom: '1rem' }}>AI History</h2>
      <p style={{ marginBottom: '2rem' }}>Detailed history view is currently under maintenance.</p>
      
      <Link href="/kr-market" style={{ color: '#60a5fa', textDecoration: 'underline' }}>
        Return to Overview
      </Link>
    </div>
  )
}
