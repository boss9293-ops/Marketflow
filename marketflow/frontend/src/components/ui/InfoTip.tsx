'use client'

import React, { useEffect, useRef, useState } from 'react'

type InfoTipProps = {
  content: React.ReactNode
  label?: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
}

export default function InfoTip({
  content,
  label = 'Info',
  side = 'top',
  className,
}: InfoTipProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearCloseTimer = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  const scheduleClose = () => {
    clearCloseTimer()
    closeTimer.current = setTimeout(() => setOpen(false), 200)
  }

  useEffect(() => {
    const handlePointer = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current) return
      if (rootRef.current.contains(event.target as Node)) return
      setOpen(false)
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('touchstart', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('touchstart', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [])

  const sideClass =
    side === 'top'
      ? 'bottom-full left-1/2 -translate-x-1/2 mb-2'
      : side === 'right'
        ? 'left-full top-1/2 -translate-y-1/2 ml-2'
        : side === 'bottom'
          ? 'top-full left-1/2 -translate-x-1/2 mt-2'
          : 'right-full top-1/2 -translate-y-1/2 mr-2'

  return (
    <span
      ref={rootRef}
      className={`relative inline-flex items-center ${className || ''}`}
      onMouseEnter={() => {
        clearCloseTimer()
        setOpen(true)
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        aria-label={label}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-white/20 text-[10px] text-slate-200 bg-white/5 hover:bg-white/10"
        onClick={() => setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
        onBlur={scheduleClose}
      >
        i
      </button>
      {open && (
        <div
          className={`absolute ${sideClass} z-50 max-w-[320px] rounded-md border border-white/10 bg-[#0f172a] px-2.5 py-2 text-xs text-slate-200 shadow-lg`}
        >
          {content}
        </div>
      )}
    </span>
  )
}
