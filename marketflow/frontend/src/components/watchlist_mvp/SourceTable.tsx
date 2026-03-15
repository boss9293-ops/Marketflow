'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'

import styles from '@/components/watchlist_mvp/watchlistMvp.module.css'
import type { EvidenceRow } from '@/lib/terminal-mvp/types'

type SectionStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'
type SortPreset = 'relevancy' | 'recent'

type SourceTableProps = {
  sessionId: string | null
  rows: EvidenceRow[]
  status: SectionStatus
  errorMessage: string | null
  onExportToSheet: (sessionId: string) => Promise<unknown>
}

const truncate = (value: string, maxLen: number): string =>
  value.length > maxLen ? `${value.slice(0, maxLen - 3)}...` : value

export default function SourceTable({
  sessionId,
  rows,
  status,
  errorMessage,
  onExportToSheet,
}: SourceTableProps) {
  const [sortPreset, setSortPreset] = useState<SortPreset>('relevancy')
  const [sourceTypeFilter, setSourceTypeFilter] = useState<string>('all')
  const [sorting, setSorting] = useState<SortingState>([{ id: 'relevance', desc: true }])
  const [csvExportStatus, setCsvExportStatus] = useState<
    'idle' | 'submitting' | 'success' | 'error'
  >('idle')
  const [csvExportMessage, setCsvExportMessage] = useState<string | null>(null)
  const [sheetExportStatus, setSheetExportStatus] = useState<
    'idle' | 'submitting' | 'success' | 'error'
  >('idle')
  const [sheetExportMessage, setSheetExportMessage] = useState<string | null>(null)

  const canExport = Boolean(sessionId) && status !== 'loading'

  useEffect(() => {
    setCsvExportStatus('idle')
    setCsvExportMessage(null)
    setSheetExportStatus('idle')
    setSheetExportMessage(null)
  }, [sessionId])

  useEffect(() => {
    if (sortPreset === 'recent') {
      setSorting([{ id: 'date', desc: true }])
      return
    }
    setSorting([{ id: 'relevance', desc: true }])
  }, [sortPreset])

  const sourceTypeOptions = useMemo(() => {
    const types = new Set<string>()
    for (const row of rows) {
      types.add(row.sourceType)
    }
    return ['all', ...Array.from(types)]
  }, [rows])

  const filteredRows = useMemo(() => {
    if (sourceTypeFilter === 'all') return rows
    return rows.filter((row) => row.sourceType === sourceTypeFilter)
  }, [rows, sourceTypeFilter])

  const columns = useMemo<ColumnDef<EvidenceRow>[]>(
    () => [
      {
        accessorKey: 'id',
        header: 'ID',
        cell: (ctx) => ctx.row.original.id.slice(0, 8),
      },
      {
        accessorKey: 'title',
        header: 'Document',
      },
      {
        id: 'date',
        accessorFn: (row) => row.publishedAtTs,
        header: 'Date',
        cell: (ctx) => ctx.row.original.publishedAtET,
      },
      {
        accessorKey: 'source',
        header: 'Source',
      },
      {
        accessorKey: 'sourceType',
        header: 'Type',
      },
      {
        accessorKey: 'summary',
        header: 'Summary',
        cell: (ctx) => truncate(ctx.row.original.summary, 120),
      },
      {
        id: 'relevance',
        accessorFn: (row) => row.aiRelevancy,
        header: 'Relevance',
        cell: (ctx) => ctx.row.original.aiRelevancy.toFixed(3),
      },
    ],
    [],
  )

  const table = useReactTable({
    data: filteredRows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  const handleExportCsv = async () => {
    if (!sessionId || !canExport) return
    setCsvExportStatus('submitting')
    setCsvExportMessage(null)
    try {
      const res = await fetch(`/api/evidence/export-csv?sessionId=${encodeURIComponent(sessionId)}`, {
        cache: 'no-store',
      })
      if (!res.ok) {
        throw new Error('Failed to export CSV.')
      }
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `evidence-${sessionId}.csv`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(url)
      setCsvExportStatus('success')
      setCsvExportMessage('CSV downloaded.')
    } catch {
      setCsvExportStatus('error')
      setCsvExportMessage('Failed to export CSV.')
    }
  }

  const handleExportToSheet = async () => {
    if (!sessionId || !canExport || sheetExportStatus === 'submitting') return
    setSheetExportStatus('submitting')
    setSheetExportMessage(null)
    try {
      await onExportToSheet(sessionId)
      setSheetExportStatus('success')
      setSheetExportMessage('Queued for sheet export.')
    } catch {
      setSheetExportStatus('error')
      setSheetExportMessage('Failed to queue sheet export.')
    }
  }

  return (
    <div className={styles.evidenceSection}>
      <div className={styles.evidenceHeader}>
        <p className={styles.askTitle}>Source Table</p>
        <div className={styles.evidenceControls}>
          <div className={styles.evidenceSortRow}>
            <button
              type="button"
              className={sortPreset === 'relevancy' ? styles.sortChipActive : styles.sortChip}
              onClick={() => setSortPreset('relevancy')}
            >
              AI Relevancy
            </button>
            <button
              type="button"
              className={sortPreset === 'recent' ? styles.sortChipActive : styles.sortChip}
              onClick={() => setSortPreset('recent')}
            >
              Recent
            </button>
          </div>
          <select
            className={styles.evidenceFilterSelect}
            value={sourceTypeFilter}
            onChange={(e) => setSourceTypeFilter(e.target.value)}
          >
            {sourceTypeOptions.map((typeValue) => (
              <option key={typeValue} value={typeValue}>
                {typeValue === 'all' ? 'All Types' : typeValue}
              </option>
            ))}
          </select>
            <button
              type="button"
              className={styles.evidenceActionButton}
              onClick={() => void handleExportCsv()}
              disabled={!canExport || csvExportStatus === 'submitting'}
            >
              {csvExportStatus === 'submitting' ? 'Exporting...' : 'Export CSV'}
            </button>
          <button
            type="button"
            className={styles.evidenceActionButton}
            onClick={() => void handleExportToSheet()}
            disabled={!canExport || sheetExportStatus === 'submitting'}
          >
            {sheetExportStatus === 'submitting' ? 'Queueing...' : 'Export to Sheets'}
          </button>
        </div>
      </div>

      {!sessionId && (
        <div className={styles.panelStateBox}>Create an Ask session first to enable evidence export.</div>
      )}

      {sheetExportMessage && (
        <div className={sheetExportStatus === 'success' ? styles.evidenceExportSuccess : styles.evidenceExportError}>
          {sheetExportMessage}
        </div>
      )}
      {csvExportMessage && (
        <div className={csvExportStatus === 'success' ? styles.evidenceExportSuccess : styles.evidenceExportError}>
          {csvExportMessage}
        </div>
      )}

      {status === 'loading' && (
        <div className={styles.panelStateBox}>Loading evidence rows...</div>
      )}
      {status === 'error' && (
        <div className={styles.panelStateBoxError}>{errorMessage ?? 'Failed to load evidence rows.'}</div>
      )}
      {status === 'empty' && (
        <div className={styles.panelStateBox}>No evidence rows stored for this session.</div>
      )}

      {status === 'ready' && (
        <div className={styles.evidenceTableWrap}>
          <table className={styles.evidenceTable}>
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => {
                const clickable = !!row.original.url
                return (
                  <tr
                    key={row.id}
                    className={clickable ? styles.evidenceRowClickable : ''}
                    onClick={() => {
                      if (!row.original.url) return
                      window.open(row.original.url, '_blank', 'noopener,noreferrer')
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
