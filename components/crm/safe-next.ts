// OWNER: lane A
//
// Pure helper shared by the login page (Server Component) and LoginForm
// (client, defensive re-check before router.replace). Never trust a `next`
// query param as a navigation target without this: it is attacker
// controlled (anyone can craft `/login?next=...`), and Next's searchParams
// already URL-decodes it for us, so an encoded control character like
// `%09` arrives here as a literal tab.
//
// Approach:
//  1. Reject anything containing a raw ASCII control character (0x00-0x1F,
//     0x7F) or a backslash before it ever reaches URL parsing: WHATWG URL
//     silently strips ASCII tab/CR/LF from its input, which is exactly how
//     `/%09/evil.com` (decoded to a literal tab between the slashes) turns
//     into the protocol-relative `//evil.com` and hard-navigates off-site.
//     Checked via `charCodeAt` comparisons, not a regex character class, so
//     there is no escape-sequence ambiguity about which bytes are matched.
//  2. Resolve the remainder against a throwaway base origin and require
//     the resolved origin to stay exactly that base: this rejects
//     scheme-relative (`//evil.com`) and absolute (`https://evil.com`)
//     targets in one check, without hand-rolling URL parsing. A dot-segment
//     input can still resolve to a protocol-relative pathname even after
//     that check, so the resolved pathname is checked separately below.
//  3. Never send the user back to `/login` itself (would loop), matching
//     against the decoded, lowercased resolved pathname so encoded or
//     dotted variants of `/login` cannot slip through either.
const BACKSLASH_CHAR_CODE = 0x5c

function hasUnsafeChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x1f || code === 0x7f || code === BACKSLASH_CHAR_CODE) return true
  }
  return false
}

const SAFE_BASE = 'http://n.invalid'

export function safeNext(value: string | undefined): string {
  if (!value) return '/'
  if (hasUnsafeChar(value)) return '/'

  let url: URL
  try {
    url = new URL(value, SAFE_BASE)
  } catch {
    return '/'
  }

  if (url.origin !== SAFE_BASE) return '/'

  // WHATWG URL resolution removes dot segments, so a dot-segment input like
  // '/.//evil.com', '/..//evil.com', or '/%2e//evil.com' can still resolve
  // to a protocol-relative pathname ('//evil.com') even though the origin
  // check above passed (the origin stays SAFE_BASE; only the pathname
  // becomes scheme-relative). Returning such a pathname as-is would
  // hard-navigate off-site, so reject it here. A leading-backslash variant
  // of this ('/\\evil.com') is not a separate case to check: any raw
  // backslash in `value` is already rejected by `hasUnsafeChar` above,
  // before parsing, and a percent-encoded one ('%5c') is left encoded in
  // `url.pathname` rather than decoded into a literal backslash, so
  // `url.pathname` can never start with a real backslash character here.
  if (url.pathname.startsWith('//')) return '/'

  // Compare the decoded, lowercased pathname (not the raw one) so encoded
  // or dotted variants of '/login' ('/%6Cogin', '/./login') are excluded
  // too, while a genuinely different route like '/loginx' is not rejected.
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(url.pathname).toLowerCase()
  } catch {
    return '/'
  }
  if (decodedPath === '/login' || decodedPath.startsWith('/login/')) return '/'

  return `${url.pathname}${url.search}${url.hash}`
}
