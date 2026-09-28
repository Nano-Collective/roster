/**
 * Pip, one row per Monday-to-Sunday week, copied from the CMO's
 * data/series/weekly.csv (playpip/cmo), which the weekly export rebuilds from
 * Umami's API and the Supabase user count. `day` counts from 19 Jul 2026, the
 * Sunday before the announcement, so the first row is the zero.
 */
export const readings = [
  { day: 0, date: "19 Jul", week: 0, total: 0, accounts: 0, note: "Before the announcement" },
  { day: 7, date: "26 Jul", week: 25, total: 25, accounts: 0, note: "Launch week, r/SideProject on 23 Jul" },
  { day: 14, date: "2 Aug", week: 25, total: 50, accounts: 0, note: "" },
  { day: 21, date: "9 Aug", week: 19, total: 69, accounts: 1, note: "The staff's first pull requests merge" },
  { day: 28, date: "16 Aug", week: 24, total: 93, accounts: 2, note: "Four weeks at about two dozen" },
  { day: 35, date: "23 Aug", week: 83, total: 176, accounts: 10, note: "The best week yet" },
  { day: 42, date: "30 Aug", week: 57, total: 233, accounts: 18, note: "" },
  { day: 49, date: "6 Sep", week: 75, total: 308, accounts: 30, note: "" },
  { day: 56, date: "13 Sep", week: 60, total: 368, accounts: 43, note: "" },
  { day: 63, date: "20 Sep", week: 65, total: 433, accounts: 72, note: "" },
  { day: 70, date: "27 Sep", week: 42, total: 475, accounts: 91, note: "A quieter week" },
] as const;

/** Since launch, from Umami's own lifetime read (data/series/totals.json). */
export const lifetime = { views: 18054, visitors: 1656, profiles: 475 };
