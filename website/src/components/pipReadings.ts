/**
 * Pip, one row per Monday-to-Sunday week, copied from the CMO's
 * data/series/weekly.csv (playpip/cmo), which the weekly export rebuilds from
 * Umami's API and the Supabase user count.
 * `total` counts every profile created, accounts included. `day` counts from
 * 19 Jul 2026, the Sunday before the announcement, so the first row is the zero.
 */
export const readings = [
  { day: 0, date: "19 Jul", week: 0, total: 0, note: "Before the announcement" },
  { day: 7, date: "26 Jul", week: 25, total: 25, note: "Launch week, r/SideProject on 23 Jul" },
  { day: 14, date: "2 Aug", week: 25, total: 50, note: "" },
  { day: 21, date: "9 Aug", week: 20, total: 70, note: "The staff's first pull requests merge" },
  { day: 28, date: "16 Aug", week: 25, total: 95, note: "Four weeks at about two dozen" },
  { day: 35, date: "23 Aug", week: 91, total: 186, note: "The best week yet" },
  { day: 42, date: "30 Aug", week: 65, total: 251, note: "" },
  { day: 49, date: "6 Sep", week: 87, total: 338, note: "" },
  { day: 56, date: "13 Sep", week: 73, total: 411, note: "" },
  { day: 63, date: "20 Sep", week: 94, total: 505, note: "" },
  { day: 70, date: "27 Sep", week: 61, total: 566, note: "A quieter week" },
] as const;

/** Since launch, from Umami's own lifetime read (data/series/totals.json). */
export const lifetime = { views: 18054, visitors: 1656, profiles: 566 };
