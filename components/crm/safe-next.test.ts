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

  // S15 round 2 (S2 gap fill): invalid percent-encoding fails
  // decodeURIComponent, which the /login-exclusion step must treat as
  // unsafe rather than let through.
  it('falls back to / for a target with invalid percent-encoding', () => {
    expect(safeNext('/%zz')).toBe('/')
  })

  // A double-dot segment spelled with percent-encoded dots (%2E is the
  // WHATWG URL spec's own case-insensitive alias for a literal '.' when
  // detecting dot segments) still resolves protocol-relative, same as the
  // literal '/..//evil.com' case above.
  it('falls back to / for a percent-encoded double-dot segment that resolves protocol-relative', () => {
    expect(safeNext('/%2E%2E//evil.com')).toBe('/')
  })

  // '%2f' (encoded '/') is never decoded by the URL parser into a literal
  // slash inside pathname, so this does not collapse into '//evil.com' the
  // way the raw-dot-segment cases above do; the final return also uses the
  // raw (still-encoded) `url.pathname`, so the value comes back unchanged
  // rather than being rejected or decoded.
  it('returns a percent-encoded slash target unchanged (does not decode into a protocol-relative path)', () => {
    expect(safeNext('/%2f/evil.com')).toBe('/%2f/evil.com')
  })

  it('falls back to / for an empty string', () => {
    expect(safeNext('')).toBe('/')
  })

  it('falls back to / for undefined', () => {
    expect(safeNext(undefined)).toBe('/')
  })
})
