import { z } from 'zod'
import { IdSchema, PageQuery } from '@/lib/contracts/common'

// [F] lib/contracts/crm.ts: see docs/design.md section 3.

export const LeadStageSchema = z.enum(['NEW', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST'])
export const LeadSourceSchema = z.enum(['WEBSITE', 'MANUAL', 'LINE'])

export const LeadListQuery = PageQuery.extend({
  q: z.string().trim().max(100).optional(),
  stage: LeadStageSchema.optional(),
  ownerId: IdSchema.optional(),
  source: LeadSourceSchema.optional(),
  companyId: IdSchema.optional(),
  open: z.enum(['true', 'false']).optional(), // open = stage not WON/LOST
  sort: z.enum(['updatedAt', 'createdAt', 'value', 'stageChangedAt']).default('updatedAt'),
  dir: z.enum(['asc', 'desc']).default('desc'),
})

export const LeadCreate = z.object({
  title: z.string().trim().min(1).max(200),
  contactId: IdSchema,
  companyId: IdSchema.nullish(),
  ownerId: IdSchema.optional(), // default = actor
  source: LeadSourceSchema.default('MANUAL'),
  value: z.number().nonnegative().max(1e10).nullish(),
})

export const LeadUpdate = LeadCreate.omit({ source: true }).partial() // stage is NOT editable here

export const StageChange = z
  .object({
    to: LeadStageSchema,
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.to !== 'LOST' || !!v.reason, { path: ['reason'], message: 'reason required for LOST' })

export const ContactCreate = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().max(100).nullish(),
  email: z.email().nullish(),
  phone: z
    .string()
    .regex(/^[0-9+\- ]{6,20}$/)
    .nullish(),
  companyId: IdSchema.nullish(),
  ownerId: IdSchema.nullish(),
  tagIds: z.array(IdSchema).max(20).optional(),
})

export const ContactUpdate = ContactCreate.partial()

export const ContactListQuery = PageQuery.extend({
  q: z.string().trim().max(100).optional(),
  companyId: IdSchema.optional(),
  hasLine: z.enum(['true', 'false']).optional(),
  tagId: IdSchema.optional(),
})

export const CompanyCreate = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z
    .string()
    .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i)
    .nullish(),
  industry: z.string().max(100).nullish(),
  sizeBand: z.string().max(50).nullish(),
})

export const CompanyUpdate = CompanyCreate.partial()

export const ActivityCreate = z.object({
  type: z.enum(['NOTE', 'CALL', 'MEETING', 'EMAIL']),
  body: z.string().trim().min(1).max(4000),
})

export const LoginInput = z.object({
  email: z.email(),
  password: z.string().min(1).max(200),
})
