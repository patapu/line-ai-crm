// OWNER: lane A
//
// Tiny className joiner (no new dependency: no clsx/tailwind-merge in
// package.json). Falsy values, empty strings and nested arrays are dropped.

export type ClassValue = string | number | null | undefined | false | Record<string, boolean | undefined> | ClassValue[]

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = []
  for (const input of inputs) {
    if (!input) continue
    if (typeof input === 'string' || typeof input === 'number') {
      out.push(String(input))
    } else if (Array.isArray(input)) {
      const nested = cn(...input)
      if (nested) out.push(nested)
    } else {
      for (const [key, value] of Object.entries(input)) {
        if (value) out.push(key)
      }
    }
  }
  return out.join(' ')
}
