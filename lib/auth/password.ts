import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto'

// [F] lib/auth/password.ts: see docs/design.md section 6.
// node:crypto scrypt + timingSafeEqual. No bcrypt dependency needed. No
// `server-only` here: it holds no secret of its own, and prisma/seed.ts (run
// via `tsx --conditions=react-server`, outside any Next.js server boundary)
// needs to import hashPassword directly.

// promisify(scrypt) drops the overload that takes an options object, so the
// cost parameters below would not type check. Wrap the callback API directly.
function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (err, derivedKey) => (err ? reject(err) : resolve(derivedKey)))
  })
}

const SALT_BYTES = 16
const KEY_LENGTH = 64
const SCRYPT_N = 131072 // 2^17
const SCRYPT_R = 8
const SCRYPT_P = 1
// Node's scrypt needs roughly 128 * N * r bytes of working memory; 256 MiB
// comfortably covers that for the cost parameters above and leaves headroom.
const SCRYPT_MAXMEM = 256 * 1024 * 1024

/** Stored format: `scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const derivedKey = (await scrypt(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  })) as Buffer
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derivedKey.toString('hex')}`
}

/**
 * Constant-time compare via timingSafeEqual. Parses the cost params from the
 * stored string itself (so a future cost bump does not break old hashes),
 * requires the decoded hash to be exactly KEY_LENGTH bytes, and returns
 * false on any malformed input instead of throwing.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const [, nRaw, rRaw, pRaw, saltHex, hashHex] = parts
  const N = Number(nRaw)
  const r = Number(rRaw)
  const p = Number(pRaw)
  const validParams =
    Number.isInteger(N) &&
    N > 1 &&
    (N & (N - 1)) === 0 &&
    Number.isInteger(r) &&
    r > 0 &&
    Number.isInteger(p) &&
    p > 0
  if (!validParams) return false

  const salt = Buffer.from(saltHex, 'hex')
  const expected = Buffer.from(hashHex, 'hex')
  if (salt.length === 0 || expected.length !== KEY_LENGTH) return false

  try {
    const actual = (await scrypt(password, salt, expected.length, { N, r, p, maxmem: SCRYPT_MAXMEM })) as Buffer
    if (actual.length !== expected.length) return false
    return timingSafeEqual(actual, expected)
  } catch {
    // Node's scrypt can still throw on cost params that pass the basic
    // sanity checks above (for example an oversized N * r * p combination).
    return false
  }
}

// Fixed dummy hash in the same stored format hashPassword produces. The hex
// values do not need to correspond to any real password: verifyPasswordDummy
// only needs to run the same scrypt cost, not actually match anything.
const DUMMY_HASH = `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${'00'.repeat(SALT_BYTES)}$${'00'.repeat(KEY_LENGTH)}`

/**
 * Runs the same scrypt cost as verifyPassword against a fixed dummy hash, so
 * a login attempt for an email that does not exist takes as long as one for
 * an email that does: no timing oracle for user enumeration. Always resolves
 * to false.
 */
export async function verifyPasswordDummy(password: string): Promise<false> {
  await verifyPassword(password, DUMMY_HASH)
  return false
}
