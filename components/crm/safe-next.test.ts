import { describe, expect, it } from 'vitest'
import { safeNext } from '@/components/crm/safe-next'

// [A] components/crm/safe-next.test.ts: pure-function tests for the
// post-login redirect sanitizer, added at S15 per the S13 review finding
// (open redirect via a pre-decoded control character, e.g. `/%09/evil.com`
// arriving here as a literal tab). No DB, no server-only import.

describe('safeNext', () => {
  it('keeps an ordinary same-origin path with a query string', () => {
    expect(safeNext('/leads?q=x')).toBe('/leads?q=x')
  })

  it('keeps an ordinary same-origin path with a hash', () => {
    expect(safeNext('/leads#x')).toBe('/leads#x')
  })

  it('falls back to / for a protocol-relative target', () => {
    expect(safeNext('//evil.com')).toBe('/')
  })

  it('falls back to / for a target containing a literal backslash', () => {
    expect(safeNext('/\\evil.com')).toBe('/')
  })

  it('falls back to / for a target containing a literal tab (the /%09/evil.com case)', () => {
    expect(safeNext('/\t/evil.com')).toBe('/')
  })

  it('falls back to / for a target containing a literal newline', () => {
    expect(safeNext('/\n/evil.com')).toBe('/')
  })

  it('falls back to / for a target containing a literal carriage return', () => {
    expect(safeNext('/\r/evil.com')).toBe('/')
  })

  it('falls back to / for a full absolute URL to another origin', () => {
    expect(safeNext('https://evil.com')).toBe('/')
  })

  it('falls back to / for a javascript: pseudo-URL', () => {
    expect(safeNext('javascript:alert(1)')).toBe('/')
  })

  it('falls back to / for the login path itself', () => {
    expect(safeNext('/login')).toBe('/')
  })

  it('falls back to / for the login path with its own next param', () => {
    expect(safeNext('/login?next=/x')).toBe('/')
  })

  // S15 round 2: S14 round 2 hardening (dot-segment resolution can still
  // produce a protocol-relative pathname even though the origin check
  // passed; the /login exclusion now compares the decoded, lowercased
  // pathname exactly, not the raw one).
  it('falls back to / for a single-dot-segment path that resolves protocol-relative', () => {
    expect(safeNext('/.//evil.com')).toBe('/')
  })

  it('falls back to / for a double-dot-segment path that resolves protocol-relative', () => {
    expect(safeNext('/..//evil.com')).toBe('/')
  })

  it('falls back to / for a percent-encoded dot segment that resolves protocol-relative', () => {
    expect(safeNext('/%2e//evil.com')).toBe('/')
  })

  it('falls back to / for a dot-segment path that resolves to /login', () => {
    expect(safeNext('/./login')).toBe('/')
  })

  it('falls back to / for a percent-encoded /login', () => {
    expect(safeNext('/%6Cogin')).toBe('/')
  })

  it('falls back to / for /LOGIN regardless of case', () => {
    expect(safeNext('/LOGIN')).toBe('/')
  })

  it('keeps a route that merely starts with "login" as its own segment', () => {
    expect(safeNext('/loginx')).toBe('/loginx')
  })

  it('falls back to / for a /login sub-path', () => {
    expect(safeNext('/login/extra')).toBe('/')
  })

  it('falls back to / for an empty string', () => {
    expect(safeNext('')).toBe('/')
  })

  it('falls back to / for undefined', () => {
    expect(safeNext(undefined)).toBe('/')
  })
})
