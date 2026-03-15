'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import styles from '@/components/watchlist_mvp/watchlistMvp.module.css'

type ChartPanelProps = {
  selectedSymbol: string
  selectedItem: {
    symbol: string
    lastPrice: string
    changePercent: string
    rangeLabel: string
  } | null
  isLoading: boolean
  errorMessage: string | null
}

declare global {
  interface Window {
    TradingView?: {
      widget: new (options: Record<string, unknown>) => unknown
    }
  }
}

const TV_SCRIPT_SRC = 'https://s3.tradingview.com/tv.js'
let tradingViewScriptPromise: Promise<void> | null = null

const EXCHANGE_MAP: Record<string, string> = {
  AAPL: 'NASDAQ',
  AMZN: 'NASDAQ',
  AMD: 'NASDAQ',
  GOOGL: 'NASDAQ',
  INTC: 'NASDAQ',
  META: 'NASDAQ',
  NFLX: 'NASDAQ',
  NVDA: 'NASDAQ',
  TSLA: 'NASDAQ',
  IBM: 'NYSE',
  XOM: 'NYSE',
}

const toTradingViewSymbol = (rawSymbol: string): string => {
  const symbol = rawSymbol.trim().toUpperCase()
  if (!symbol) return 'NASDAQ:QQQ'
  if (symbol.includes(':')) return symbol
  const exchange = EXCHANGE_MAP[symbol] ?? 'NASDAQ'
  return `${exchange}:${symbol}`
}

const loadTradingViewScript = (): Promise<void> => {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.TradingView) return Promise.resolve()
  if (tradingViewScriptPromise) return tradingViewScriptPromise

  tradingViewScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${TV_SCRIPT_SRC}"]`) as
      | HTMLScriptElement
      | null

    if (existing) {
      if (window.TradingView) {
        resolve()
        return
      }
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Failed to load TradingView script.')), {
        once: true,
      })
      return
    }

    const script = document.createElement('script')
    script.src = TV_SCRIPT_SRC
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load TradingView script.'))
    document.head.appendChild(script)
  })

  return tradingViewScriptPromise
}

const applyApprox40TradingDaysRange = (widgetInstance: unknown) => {
  const widget = widgetInstance as {
    onChartReady?: (cb: () => void) => void
    chart?: () => { setVisibleRange?: (range: { from: number; to: number }) => void }
    activeChart?: () => { setVisibleRange?: (range: { from: number; to: number }) => void }
  }
  if (!widget.onChartReady) return

  widget.onChartReady(() => {
    const chart = widget.chart?.() ?? widget.activeChart?.()
    if (!chart?.setVisibleRange) return
    // Approximate 40 trading sessions with 56 calendar days.
    const to = Math.floor(Date.now() / 1000)
    const from = to - 56 * 24 * 60 * 60
    chart.setVisibleRange({ from, to })
  })
}

export default function ChartPanel({
  selectedSymbol,
  selectedItem,
  isLoading,
  errorMessage,
}: ChartPanelProps) {
  const currentSymbol = selectedSymbol || selectedItem?.symbol || '---'
  const changePct = selectedItem?.changePercent ?? '--'
  const isDown = changePct.trim().startsWith('-')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const containerId = useMemo(
    () => `tv-widget-${Math.random().toString(36).slice(2, 10)}`,
    [],
  )
  const tradingViewSymbol = useMemo(
    () => toTradingViewSymbol(selectedSymbol || selectedItem?.symbol || ''),
    [selectedItem?.symbol, selectedSymbol],
  )

  const [widgetError, setWidgetError] = useState<string | null>(null)
  const [widgetLoading, setWidgetLoading] = useState<boolean>(true)
  const [chartInterval, setChartInterval] = useState<'1' | 'D'>('D')

  useEffect(() => {
    let cancelled = false
    const mountWidget = async () => {
      if (isLoading || !!errorMessage) return
      if (!containerRef.current) return
      setWidgetLoading(true)
      setWidgetError(null)
      try {
        await loadTradingViewScript()
        if (cancelled) return
        if (!containerRef.current) return
        if (!window.TradingView?.widget) {
          throw new Error('TradingView widget constructor is unavailable.')
        }

        containerRef.current.innerHTML = ''
        // Recreate widget whenever the selected symbol mapping changes.
        const widget = new window.TradingView.widget({
          container_id: containerId,
          symbol: tradingViewSymbol,
          interval: chartInterval,
          theme: 'dark',
          toolbar_bg: '#050505',
          timezone: 'America/New_York',
          autosize: true,
          locale: 'en',
          allow_symbol_change: false,
          withdateranges: false,
          favorites: {
            intervals: ['1', 'D'],
          },
          hide_side_toolbar: true,
          hide_top_toolbar: true,
          overrides: {
            'paneProperties.background': '#000000',
            'paneProperties.vertGridProperties.color': '#111111',
            'paneProperties.horzGridProperties.color': '#111111',
            'symbolWatermarkProperties.color': 'rgba(255,255,255,0.06)',
            'scalesProperties.textColor': '#7A7A7A',
            'mainSeriesProperties.candleStyle.upColor': '#00ff66',
            'mainSeriesProperties.candleStyle.downColor': '#ff4040',
            'mainSeriesProperties.candleStyle.wickUpColor': '#00ff66',
            'mainSeriesProperties.candleStyle.wickDownColor': '#ff4040',
            'mainSeriesProperties.candleStyle.borderUpColor': '#00ff66',
            'mainSeriesProperties.candleStyle.borderDownColor': '#ff4040',
            'mainSeriesProperties.areaStyle.color1': 'rgba(255,255,255,0.08)',
            'mainSeriesProperties.areaStyle.color2': 'rgba(255,255,255,0.02)',
            'mainSeriesProperties.areaStyle.linecolor': '#c8c8c8',
          },
        })
        applyApprox40TradingDaysRange(widget)
      } catch (error) {
        if (cancelled) return
        setWidgetError(
          error instanceof Error ? error.message : 'Failed to render TradingView widget.',
        )
      } finally {
        if (!cancelled) {
          setWidgetLoading(false)
        }
      }
    }

    void mountWidget()
    return () => {
      cancelled = true
      if (containerRef.current) {
        containerRef.current.innerHTML = ''
      }
    }
  }, [containerId, tradingViewSymbol, isLoading, errorMessage, chartInterval])

  return (
    <article className={styles.chartPanel}>
      <div className={styles.chartHeader}>
        <div>
          <p className={styles.panelLabel}>Price Console</p>
          <h3 className={styles.panelTitle}>{currentSymbol}</h3>
          <p className={styles.panelSubtle}>
            TradingView Advanced Chart ({tradingViewSymbol}, D, America/New_York)
          </p>
        </div>
        <div className={styles.chartPriceBox}>
          <p className={styles.chartPrice}>{selectedItem?.lastPrice ?? '--'}</p>
          <p className={isDown ? styles.chartChangeDown : styles.chartChangeUp}>{changePct}</p>
        </div>
      </div>

      <p className={styles.chartRangeLabel}>
        {selectedItem?.rangeLabel ?? 'Day range metadata unavailable.'}
      </p>
      <div className={styles.ohlcvRow}>
        <div className={styles.ohlcvCell}>
          <span className={styles.ohlcvKey}>O</span>
          <span className={styles.ohlcvValue}>--</span>
        </div>
        <div className={styles.ohlcvCell}>
          <span className={styles.ohlcvKey}>H</span>
          <span className={styles.ohlcvValue}>--</span>
        </div>
        <div className={styles.ohlcvCell}>
          <span className={styles.ohlcvKey}>L</span>
          <span className={styles.ohlcvValue}>--</span>
        </div>
        <div className={styles.ohlcvCell}>
          <span className={styles.ohlcvKey}>C</span>
          <span className={styles.ohlcvValue}>{selectedItem?.lastPrice ?? '--'}</span>
        </div>
        <div className={styles.ohlcvCell}>
          <span className={styles.ohlcvKey}>VOL</span>
          <span className={styles.ohlcvValue}>--</span>
        </div>
      </div>

      {isLoading && (
        <div className={styles.panelStateBox}>Loading selected symbol chart metadata...</div>
      )}

      {!isLoading && errorMessage && (
        <div className={styles.panelStateBoxError}>{errorMessage}</div>
      )}

      {!isLoading && !errorMessage && (
        <div className={styles.tvWidgetFrame} style={{ position: 'relative' }}>
          <div
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              zIndex: 5,
              display: 'flex',
              gap: 6,
            }}
          >
            <button
              type="button"
              onClick={() => setChartInterval('1')}
              style={{
                border: chartInterval === '1' ? '1px solid #86efac' : '1px solid #2a2a2a',
                background: chartInterval === '1' ? 'rgba(134, 239, 172, 0.18)' : '#0b0b0b',
                color: chartInterval === '1' ? '#86efac' : '#8f9aa7',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 700,
                padding: '3px 7px',
                cursor: 'pointer',
              }}
            >
              1m
            </button>
            <button
              type="button"
              onClick={() => setChartInterval('D')}
              style={{
                border: chartInterval === 'D' ? '1px solid #86efac' : '1px solid #2a2a2a',
                background: chartInterval === 'D' ? 'rgba(134, 239, 172, 0.18)' : '#0b0b0b',
                color: chartInterval === 'D' ? '#86efac' : '#8f9aa7',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 700,
                padding: '3px 7px',
                cursor: 'pointer',
              }}
            >
              1D
            </button>
          </div>
          {(widgetLoading || widgetError) && (
            <div className={widgetError ? styles.panelStateBoxError : styles.panelStateBox}>
              {widgetError ?? 'Loading TradingView chart widget...'}
            </div>
          )}
          <div id={containerId} ref={containerRef} className={styles.tvWidgetContainer} />
        </div>
      )}
    </article>
  )
}
