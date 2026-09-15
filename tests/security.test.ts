import { describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { withRoute, readJson } from '@/lib/http'
import { canActOnLead, type Actor } from '@/lib/auth/dal'
import { verifyPassword } from '@/lib/auth/password'
import { log } from '@/lib/log'

// [F] tests/security.test.ts: needs NO database. Covers the withRoute CSRF
// and error-envelope behaviour from lib/http.ts section 6, the ownership
// gate from lib/auth/dal.ts section 3, malformed password hashes, and
// recursive log redaction. vitest.setup.ts sets APP_URL to
// http://localhost:3000, which the withRoute tests below rely on.
vi.mock('@/lib/db')

function makeRequest(opts: {
  method?: string
  origin?: string
  contentType?: string
  body?: string
} = {}): NextRequest {
  const { method = 'POST', origin, contentType, body } = opts
  const headers: Record<string, string> = {}
  if (origin !== undefined) headers['origin'] = origin
  if (contentType !== undefined) headers['content-type'] = contentType
  if (body !== undefined) headers['content-length'] = String(Buffer.byteLength(body))
  return new NextRequest('http://localhost:3000/api/test', { method, headers, body })
}

describe('withRoute CSRF and error envelope', () => {
  it('returns 403 on a cross-origin POST', async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }))
    const wrapped = withRoute('test.route', handler)
    const req = makeRequest({
      origin: 'https://evil.example',
      contentType: 'application/json',
      body: '{}',
    })

    const res = await wrapped(req, {})

    expect(res.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })

  it('returns 400 on a POST with a body but a non-JSON content type', async () => {
    const handler = vi.fn(async () => NextResponse.json({ ok: true }))
    const wrapped = withRoute('test.route', handler)
    const req = makeRequest({
      origin: 'http://localhost:3000',
      contentType: 'text/plain',
      body: 'hello',
    })

    const res = await wrapped(req, {})

    expect(res.status).toBe(400)
    expect(handler).not.toHaveBeenCalled()
  })

  it('maps a thrown generic Error to a 500 with no stack in the body', async () => {
    const handler = vi.fn(async () => {
      throw new Error('boom, this must never reach the client')
    })
    const wrapped = withRoute('test.route', handler, { public: true })
    const req = makeRequest({ method: 'GET' })

    const res = await wrapped(req, {})
    const json = (await res.json()) as { error: Record<string, unknown> }

    expect(res.status).toBe(500)
    expect(json.error.code).toBe('INTERNAL')
    expect(json.error).not.toHaveProperty('stack')
    expect(JSON.stringify(json)).not.toContain('boom')
  })
})

describe('readJson', () => {
  it('maps malformed JSON to a VALIDATION_FAILED DomainError', async () => {
    const req = new Request('http://localhost:3000/api/test', {
      method: 'POST',
      body: '{ this is not valid json',
      headers: { 'content-type': 'application/json' },
    })
    const schema = z.object({ foo: z.string() })

    await expect(readJson(req, schema)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
  })
})

describe('canActOnLead', () => {
  const lead = { ownerId: 'user_owner' }

  it('allows the owner', () => {
    const actor: Actor = { kind: 'user', id: 'user_owner', role: 'SALES', name: 'Owner' }
    expect(canActOnLead(actor, lead)).toBe(true)
  })

  it('allows an admin who does not own the lead', () => {
    const actor: Actor = { kind: 'user', id: 'user_admin', role: 'ADMIN', name: 'Admin' }
    expect(canActOnLead(actor, lead)).toBe(true)
  })

  it('blocks another sales user', () => {
    const actor: Actor = { kind: 'user', id: 'user_other', role: 'SALES', name: 'Other' }
    expect(canActOnLead(actor, lead)).toBe(false)
  })

  it('allows a system actor', () => {
    const actor: Actor = { kind: 'system', source: 'line-webhook' }
    expect(canActOnLead(actor, lead)).toBe(true)
  })
})

describe('verifyPassword on malformed hash strings', () => {
  it.each([
    'not-a-hash',
    'scrypt$abc$8$1$00$00',
    'scrypt$131072$8$1$$',
    'bcrypt$131072$8$1$00$00',
    'scrypt:oldformat:hash',
  ])('returns false for %s', async (badHash) => {
    await expect(verifyPassword('anything', badHash)).resolves.toBe(false)
  })
})

describe('log redaction with nested and cyclic objects', () => {
  it('redacts secret-shaped keys at any depth and never throws on a cycle', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const cyclic: Record<string, unknown> = { leadId: 'lead_1' }
    cyclic.self = cyclic

    const fields = {
      leadId: 'lead_1',
      contact: {
        email: 'user@example.com',
        deep: { apiKey: 'sk-super-secret', cyclic },
      },
    }

    expect(() => log('info', 'test.nested', fields)).not.toThrow()

    // Read the call before mockRestore(): in Vitest 4 restoring also clears mock.calls.
    const line = spy.mock.calls[0]?.[0] as string
    spy.mockRestore()

    expect(line).not.toContain('user@example.com')
    expect(line).not.toContain('sk-super-secret')

    const parsed = JSON.parse(line)
    expect(parsed.contact.email).toBe('[REDACTED]')
    expect(parsed.contact.deep.apiKey).toBe('[REDACTED]')
    expect(parsed.contact.deep.cyclic.self).toBe('[CIRCULAR]')
  })
})
