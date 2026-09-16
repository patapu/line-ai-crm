import { NextResponse } from 'next/server'
import { withRoute, readJson } from '@/lib/http'
import { requireUser } from '@/lib/auth/dal'
import { DomainError } from '@/lib/errors'
import { ContactUpdate } from '@/lib/contracts/crm'
import { deleteContact, getContact, parseIdOrNotFound, updateContact } from '@/modules/crm/service'

// [A] app/api/contacts/[id]/route.ts: see docs/design.md section 3's API
// table. DELETE is a hard delete; deleteContact throws CONFLICT (409) when
// the contact still has leads or messages.

export const GET = withRoute<RouteContext<'/api/contacts/[id]'>>('GET /api/contacts/[id]', async (req, ctx) => {
  await requireUser(req)
  const id = parseIdOrNotFound((await ctx.params).id, 'contact')
  const contact = await getContact(id)
  if (!contact) throw new DomainError('NOT_FOUND', 'contact not found')
  return NextResponse.json(contact)
})

export const PATCH = withRoute<RouteContext<'/api/contacts/[id]'>>('PATCH /api/contacts/[id]', async (req, ctx) => {
  const actor = await requireUser(req)
  const id = parseIdOrNotFound((await ctx.params).id, 'contact')
  const input = await readJson(req, ContactUpdate)
  const contact = await updateContact(id, input, actor)
  return NextResponse.json(contact)
})

export const DELETE = withRoute<RouteContext<'/api/contacts/[id]'>>('DELETE /api/contacts/[id]', async (req, ctx) => {
  const actor = await requireUser(req)
  const id = parseIdOrNotFound((await ctx.params).id, 'contact')
  await deleteContact(id, actor)
  return new NextResponse(null, { status: 204 })
})
