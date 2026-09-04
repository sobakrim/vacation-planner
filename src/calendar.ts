import type { DayPart, VacationEntry } from './types'
import { getVaudPublicHoliday } from './vaudHolidays'

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

export function formatVacationRange(start: string, end: string, startPart: DayPart = 'full', endPart: DayPart = 'full') {
  const base = formatRange(start, end)
  if (start === end) {
    if (startPart === 'morning') return `${base} · morning`
    if (startPart === 'afternoon') return `${base} · afternoon`
    return base
  }
  const first = startPart === 'afternoon' ? ' · starts afternoon' : ''
  const last = endPart === 'morning' ? ' · ends morning' : ''
  return `${base}${first}${last}`
}

export function daysInclusive(start: string, end: string) {
  const ms = parseIsoDate(end).getTime() - parseIsoDate(start).getTime()
  return Math.round(ms / 86400000) + 1
}

export function vacationDaysCharged(
  start: string,
  end: string,
  startPart: DayPart = 'full',
  endPart: DayPart = 'full',
) {
  if (!start || !end || end < start) return 0
  let cursor = parseIsoDate(start)
  const last = parseIsoDate(end)
  let count = 0
  while (cursor <= last) {
    const day = cursor.getDay()
    const date = isoDate(cursor)
    if (day !== 0 && day !== 6 && !getVaudPublicHoliday(date)) {
      if (start === end && (startPart === 'morning' || startPart === 'afternoon')) count += 0.5
      else if (date === start && startPart === 'afternoon') count += 0.5
      else if (date === end && endPart === 'morning') count += 0.5
      else count += 1
    }
    cursor = addDays(cursor, 1)
  }
  return count
}

export function workingDaysInclusive(start: string, end: string) {
  return vacationDaysCharged(start, end, 'full', 'full')
}

export function entryPartForDate(entry: VacationEntry, dateIso: string): DayPart {
  if (entry.start_date === entry.end_date) return entry.start_part
  if (dateIso === entry.start_date && entry.start_part === 'afternoon') return 'afternoon'
  if (dateIso === entry.end_date && entry.end_part === 'morning') return 'morning'
  return 'full'
}

export function dayPartShort(part: DayPart) {
  if (part === 'morning') return 'AM'
  if (part === 'afternoon') return 'PM'
  return ''
}
