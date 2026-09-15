// OWNER: lane A
//
// Pure, deterministic formatters given their inputs: safe to call from a
// component render body (no Date.now()/new Date() with no arguments).

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  })
}

export function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat('th-TH', { style: 'currency', currency }).format(value)
}

export function fullName(first: string, last: string | null): string {
  return last ? `${first} ${last}` : first
}
