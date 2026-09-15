import { NextResponse } from 'next/server'
import { withRoute, readJson } from '@/lib/http'
import { requireUser } from '@/lib/auth/dal'
import { ContactCreate, ContactListQuery } from '@/lib/contracts/crm'
import { queryObject } from '@/modules/crm/repository'
import { createContact, listContacts } from '@/modules/crm/service'

// [A] app/api/contacts/route.ts: see docs/design.md section 3's API table.

export const GET = withRoute('GET /api/contacts', async (req) => {
  await requireUser(req)
  const q = ContactListQuery.parse(queryObject(req.nextUrl.searchParams))
  return NextResponse.json(await listContacts(q))
})

export const POST = withRoute('POST /api/contacts', async (req) => {
  const actor = await requireUser(req)
  const input = await readJson(req, ContactCreate)
  const contact = await createContact(input, actor)
  return NextResponse.json(contact, { status: 201 })
})
