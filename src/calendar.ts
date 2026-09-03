import type { VacationEntry } from './types'

export function isoDate(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function parseIsoDate(value: string) {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(date: Date, count: number) {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + count)
  return copy
}

export function startOfCalendarMonth(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const mondayIndex = (first.getDay() + 6) % 7
  return addDays(first, -mondayIndex)
}

export function endOfCalendarMonth(month: Date) {
  return addDays(startOfCalendarMonth(month), 41)
}

export function entriesForDate(entries: VacationEntry[], dateIso: string) {
  return entries.filter((entry) => entry.start_date <= dateIso && entry.end_date >= dateIso)
}

export function formatRange(start: string, end: string) {
  const fmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  if (start === end) return fmt.format(parseIsoDate(start))
  return `${fmt.format(parseIsoDate(start))} – ${fmt.format(parseIsoDate(end))}`
}

export function daysInclusive(start: string, end: string) {
  const ms = parseIsoDate(end).getTime() - parseIsoDate(start).getTime()
  return Math.round(ms / 86400000) + 1
}
