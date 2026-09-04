export interface VaudPublicHoliday {
  date: string
  name: string
}

// Official Canton of Vaud public holidays. Source: vd.ch/vacances.
// The additional day off sometimes granted to cantonal-administration staff
// (normally 26 December) is intentionally not included because it is not a
// general Vaud public holiday.
export const VAUD_PUBLIC_HOLIDAYS: VaudPublicHoliday[] = [
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-01-02', name: '2 January public holiday' },
  { date: '2026-04-03', name: 'Good Friday' },
  { date: '2026-04-06', name: 'Easter Monday' },
  { date: '2026-05-14', name: 'Ascension Day' },
  { date: '2026-05-25', name: 'Whit Monday' },
  { date: '2026-08-01', name: 'Swiss National Day' },
  { date: '2026-09-21', name: 'Monday after Federal Fast' },
  { date: '2026-12-25', name: 'Christmas Day' },

  { date: '2027-01-01', name: "New Year's Day" },
  { date: '2027-01-02', name: '2 January public holiday' },
  { date: '2027-03-26', name: 'Good Friday' },
  { date: '2027-03-29', name: 'Easter Monday' },
  { date: '2027-05-06', name: 'Ascension Day' },
  { date: '2027-05-17', name: 'Whit Monday' },
  { date: '2027-08-01', name: 'Swiss National Day' },
  { date: '2027-09-20', name: 'Monday after Federal Fast' },
  { date: '2027-12-25', name: 'Christmas Day' },

  { date: '2028-01-01', name: "New Year's Day" },
  { date: '2028-01-02', name: '2 January public holiday' },
  { date: '2028-04-14', name: 'Good Friday' },
  { date: '2028-04-17', name: 'Easter Monday' },
  { date: '2028-05-25', name: 'Ascension Day' },
  { date: '2028-06-05', name: 'Whit Monday' },
  { date: '2028-08-01', name: 'Swiss National Day' },
  { date: '2028-09-18', name: 'Monday after Federal Fast' },
  { date: '2028-12-25', name: 'Christmas Day' },

  { date: '2029-01-01', name: "New Year's Day" },
  { date: '2029-01-02', name: '2 January public holiday' },
  { date: '2029-03-30', name: 'Good Friday' },
  { date: '2029-04-02', name: 'Easter Monday' },
  { date: '2029-05-10', name: 'Ascension Day' },
  { date: '2029-05-21', name: 'Whit Monday' },
  { date: '2029-08-01', name: 'Swiss National Day' },
  { date: '2029-09-17', name: 'Monday after Federal Fast' },
  { date: '2029-12-25', name: 'Christmas Day' },

  { date: '2030-01-01', name: "New Year's Day" },
  { date: '2030-01-02', name: '2 January public holiday' },
  { date: '2030-04-19', name: 'Good Friday' },
  { date: '2030-04-22', name: 'Easter Monday' },
  { date: '2030-05-30', name: 'Ascension Day' },
  { date: '2030-06-10', name: 'Whit Monday' },
  { date: '2030-08-01', name: 'Swiss National Day' },
  { date: '2030-09-16', name: 'Monday after Federal Fast' },
  { date: '2030-12-25', name: 'Christmas Day' },

  { date: '2031-01-01', name: "New Year's Day" },
  { date: '2031-01-02', name: '2 January public holiday' },
  { date: '2031-04-11', name: 'Good Friday' },
  { date: '2031-04-14', name: 'Easter Monday' },
  { date: '2031-05-22', name: 'Ascension Day' },
  { date: '2031-06-02', name: 'Whit Monday' },
  { date: '2031-08-01', name: 'Swiss National Day' },
  { date: '2031-09-22', name: 'Monday after Federal Fast' },
  { date: '2031-12-25', name: 'Christmas Day' },
]

const holidayByDate = new Map(VAUD_PUBLIC_HOLIDAYS.map((holiday) => [holiday.date, holiday]))

export function getVaudPublicHoliday(dateIso: string) {
  return holidayByDate.get(dateIso) ?? null
}
