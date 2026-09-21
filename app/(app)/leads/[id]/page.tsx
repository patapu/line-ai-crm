// OWNER: lane A — Server Component
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { canActOnLead, getActor } from '@/lib/auth/dal'
import { getLeadDetail, getLeadTimeline, listCompanyOptions, listUsers } from '@/modules/crm/service'
import { IdSchema } from '@/lib/contracts/common'
import { Card } from '@/components/ui/Card'
import { formatDateTime, formatMoney } from '@/components/ui/format'
import { StageBadge } from '@/components/crm/StageBadge'
import { StageChanger } from '@/components/crm/StageChanger'
import { LeadForm } from '@/components/crm/LeadForm'
import { ActivityForm } from '@/components/crm/ActivityForm'
import { Timeline } from '@/components/crm/Timeline'
import { InsightPanel } from '@/components/copilot/InsightPanel'
import { Composer } from '@/components/messages/Composer'

export default async function LeadDetailPage(props: PageProps<'/leads/[id]'>) {
  const { id } = await props.params
  const actor = await getActor()
  if (!IdSchema.safeParse(id).success) notFound()

  const lead = await getLeadDetail(id)
  if (!lead) notFound()

  const [timeline, users, companies] = await Promise.all([
    getLeadTimeline(id, { limit: 30 }),
    listUsers(),
    listCompanyOptions(),
  ])

  const canAct = canActOnLead(actor, { ownerId: lead.ownerId })
  const contactName = lead.contact.lastName
    ? `${lead.contact.firstName} ${lead.contact.lastName}`
    : lead.contact.firstName

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="flex flex-col gap-4 lg:col-span-2">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="min-w-0 break-words text-xl font-bold text-primary-2">{lead.title}</h1>
            <StageBadge stage={lead.stage} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm text-ink">
            <div>
              <dt className="text-xs font-semibold text-muted">Contact</dt>
              <dd>
                <Link href={`/contacts/${lead.contact.id}`} className="text-primary-2 hover:underline">
                  {contactName}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-muted">Company</dt>
              <dd>
                {lead.company ? (
                  <Link href={`/companies/${lead.company.id}`} className="text-primary-2 hover:underline">
                    {lead.company.name}
                  </Link>
                ) : (
                  '-'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-muted">Owner</dt>
              <dd>{lead.owner.name}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-muted">มูลค่า</dt>
              <dd>{lead.value !== null ? formatMoney(lead.value, lead.currency) : '-'}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-muted">Score</dt>
              <dd>{lead.score ?? '-'}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold text-muted">อัปเดตล่าสุด</dt>
              <dd>{formatDateTime(lead.updatedAt)}</dd>
            </div>
            {lead.lostReason ? (
              <div className="col-span-2">
                <dt className="text-xs font-semibold text-muted">เหตุผลที่ปิดไม่สำเร็จ</dt>
                <dd>{lead.lostReason}</dd>
              </div>
            ) : null}
          </dl>
        </Card>

        <Card>
          <h2 className="mb-3 text-base font-semibold text-primary-2">เปลี่ยนสถานะ</h2>
          <StageChanger leadId={lead.id} stage={lead.stage} canChange={canAct} />
        </Card>

        {canAct ? (
          <Card>
            <h2 className="mb-3 text-base font-semibold text-primary-2">แก้ไข Lead</h2>
            <LeadForm mode="edit" lead={lead} users={users} companies={companies} canReassign={actor.role === 'ADMIN'} />
          </Card>
        ) : null}

        <Card>
          <h2 className="mb-3 text-base font-semibold text-primary-2">เพิ่มกิจกรรม</h2>
          <ActivityForm leadId={lead.id} />
        </Card>

        <div>
          <h2 className="mb-3 text-base font-semibold text-primary-2">Timeline</h2>
          <Timeline key={timeline.items[0]?.id ?? 'empty'} leadId={id} initial={timeline} canRetry={canAct} />
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <InsightPanel leadId={lead.id} canApprove={canAct} />
        <Composer leadId={lead.id} canSend={canAct} hasLine={lead.contact.hasLine} />
      </div>
    </div>
  )
}
