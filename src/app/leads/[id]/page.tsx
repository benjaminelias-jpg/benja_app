import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq, and, asc } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { users, messages, products } from '@/db/schema';
import { getCurrentOrg, getDefaultPipeline } from '@/server/context';
import { getLead } from '@/server/services/leads';
import { getLeadTimeline } from '@/server/services/events';
import { touchesForLead } from '@/server/services/attribution';
import { listAppointmentsForLead, listDealsForLead } from '@/server/services/commerce';
import { Card, SectionTitle, Table, Th, Td, EmptyState, Badge, Avatar } from '@/components/ui';
import { StageSelect } from '@/components/stage-select';
import { OwnerSelect, TagInput } from '@/components/lead-controls';
import { LeadQuickActions, LeadNotes } from '@/components/lead-actions';
import { setMeetingOutcomeAction } from '@/app/leads/actions';
import { formatMoney, formatDate, formatDateTime, timeAgo } from '@/lib/format';
import { openLeadChatAction } from '@/app/inbox/actions';
import { profileLink } from '@/server/integrations/instagram';

export const dynamic = 'force-dynamic';

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const org = await getCurrentOrg();
  const row = await getLead(org.id, id);
  if (!row) notFound();

  const db = await getDb();
  const [pipelineData, timeline, touches, appointments, deals, team, conversation, catalog] =
    await Promise.all([
      getDefaultPipeline(org.id),
      getLeadTimeline(id, 60),
      touchesForLead(id),
      listAppointmentsForLead(id),
      listDealsForLead(id),
      db.select().from(users).where(and(eq(users.orgId, org.id), eq(users.active, true))),
      db.select().from(messages).where(eq(messages.leadId, id)).orderBy(asc(messages.sentAt)).limit(40),
      db.select().from(products).where(eq(products.orgId, org.id)),
    ]);

  const lead = row.lead;
  const displayName = lead.fullName ?? (lead.igUsername ? `@${lead.igUsername}` : 'Lead sin nombre');

  return (
    <div className="space-y-5">
      <nav className="text-xs text-muted">
        <Link href="/leads" className="hover:underline">
          Leads
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink-2">{displayName}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Avatar name={displayName} src={lead.profilePicUrl} size={48} />
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ink">{displayName}</h1>
            <p className="mt-0.5 text-sm text-muted">
              {lead.igUsername ? `@${lead.igUsername}` : ''}
              {lead.email ? ` · ${lead.email}` : ''}
              {lead.country ? ` · ${lead.country}` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form action={openLeadChatAction}>
            <input type="hidden" name="leadId" value={lead.id} />
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white"
              style={{ background: 'var(--series-1)' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.8-.9L3 20.5l1.5-4.4A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4Z" />
              </svg>
              Abrir chat
            </button>
          </form>

          {lead.igUsername ? (
            <a
              href={profileLink(lead.igUsername)}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-surface px-3 py-1.5 text-xs text-ink-2 hairline hover:text-ink"
            >
              Ver perfil ↗
            </a>
          ) : null}

          {pipelineData ? (
            <StageSelect
              leadId={lead.id}
              stageId={lead.stageId}
              stages={pipelineData.stages.map((stage) => ({ id: stage.id, name: stage.name }))}
            />
          ) : null}
          <OwnerSelect
            leadId={lead.id}
            ownerId={lead.ownerId}
            users={team.map((member) => ({ id: member.id, name: member.name }))}
          />
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr]">
        <div className="space-y-4">
          <Card>
            <SectionTitle title="Atribucion" hint="De donde salio este lead" />
            {row.content ? (
              <div className="rounded-lg bg-surface-2 p-3">
                <p className="text-[11px] text-muted">Primer contacto</p>
                <Link
                  href={`/contenido/${row.content.id}`}
                  className="mt-0.5 block text-sm font-medium text-ink hover:underline"
                >
                  {row.content.title}
                </Link>
                {row.content.hook ? (
                  <p className="mt-1 line-clamp-2 text-xs text-ink-2">“{row.content.hook}”</p>
                ) : null}
              </div>
            ) : (
              <EmptyState
                title="Sin contenido atribuido"
                hint="Llego sin referencia a ninguna publicacion."
              />
            )}

            <dl className="mt-4 space-y-2 text-xs">
              <Row label="Origen" value={lead.source} />
              <Row label="Creado" value={formatDateTime(lead.createdAt)} />
              <Row label="Ultima interaccion" value={timeAgo(lead.lastInteractionAt)} />
              <Row
                label="Ingresos"
                value={lead.revenueCents > 0 ? formatMoney(lead.revenueCents, org.currency) : '—'}
              />
              {lead.manychatSubscriberId ? (
                <Row label="ManyChat" value={lead.manychatSubscriberId} mono />
              ) : null}
              {lead.followersCount ? (
                <Row label="Seguidores" value={String(lead.followersCount)} />
              ) : null}
            </dl>
          </Card>

          <Card>
            <SectionTitle title="Acciones" hint="Lo que pasa fuera de Instagram también tiene que entrar al reporte" />
            <LeadQuickActions
              leadId={lead.id}
              team={team.map((member) => ({ id: member.id, name: member.name }))}
              products={catalog.map((product) => ({
                id: product.id,
                name: product.name,
                priceCents: product.priceCents,
              }))}
              currency={org.currency}
            />
          </Card>

          <Card>
            <SectionTitle title="Notas" />
            <LeadNotes leadId={lead.id} notes={lead.notes} />
          </Card>

          <Card>
            <SectionTitle title="Etiquetas" />
            <div className="mb-3 flex flex-wrap gap-1.5">
              {lead.tags.length === 0 ? (
                <span className="text-xs text-muted">Sin etiquetas</span>
              ) : (
                lead.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)
              )}
            </div>
            <TagInput leadId={lead.id} />
          </Card>

          {touches.length > 1 ? (
            <Card>
              <SectionTitle title="Recorrido de contenidos" hint="Todas las piezas que lo tocaron" />
              <ol className="space-y-2">
                {touches.map((entry) => (
                  <li key={entry.touch.id} className="flex items-start gap-2 text-xs">
                    <Badge color={entry.touch.type === 'first' ? 'var(--series-1)' : undefined}>
                      {entry.touch.type === 'first' ? '1er' : 'asist.'}
                    </Badge>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 text-ink-2">
                        {entry.content?.title ?? 'Contenido eliminado'}
                      </span>
                      <span className="text-muted">{formatDate(entry.touch.occurredAt)}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          {deals.length > 0 || appointments.length > 0 ? (
            <Card>
              <SectionTitle title="Reuniones y ventas" />
              <Table>
                <thead>
                  <tr>
                    <Th>Tipo</Th>
                    <Th>Detalle</Th>
                    <Th>Fecha</Th>
                    <Th align="right">Importe</Th>
                  </tr>
                </thead>
                <tbody>
                  {appointments.map((appointment) => (
                    <tr key={appointment.id}>
                      <Td>
                        <Badge color="var(--ramp-3)">Reunion</Badge>
                      </Td>
                      <Td>
                        <span className="text-xs">
                          {appointment.title} · {appointmentStatusLabel(appointment.status)}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-xs">{formatDateTime(appointment.scheduledAt)}</span>
                      </Td>
                      <Td align="right">
                        {appointment.status === 'scheduled' || appointment.status === 'confirmed' ? (
                          <span className="flex justify-end gap-1">
                            {(['held', 'no_show'] as const).map((status) => (
                              <form key={status} action={setMeetingOutcomeAction}>
                                <input type="hidden" name="appointmentId" value={appointment.id} />
                                <input type="hidden" name="leadId" value={lead.id} />
                                <input type="hidden" name="status" value={status} />
                                <button
                                  type="submit"
                                  className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] text-ink-2 hairline hover:text-ink"
                                >
                                  {status === 'held' ? 'Asistió' : 'No asistió'}
                                </button>
                              </form>
                            ))}
                          </span>
                        ) : (
                          '—'
                        )}
                      </Td>
                    </tr>
                  ))}
                  {deals.map((entry) => (
                    <tr key={entry.deal.id}>
                      <Td>
                        <Badge color="var(--good)">Venta</Badge>
                      </Td>
                      <Td>
                        <span className="text-xs">{entry.product?.name ?? 'Producto'}</span>
                      </Td>
                      <Td>
                        <span className="text-xs">{formatDate(entry.deal.closedAt)}</span>
                      </Td>
                      <Td align="right">
                        <span className="font-medium" style={{ color: 'var(--good-text)' }}>
                          {formatMoney(entry.deal.amountCents, entry.deal.currency)}
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ) : null}

          {conversation.length > 0 ? (
            <Card>
              <SectionTitle title="Conversacion" hint="Mensajes de Instagram, entrantes y automaticos" />
              <ol className="space-y-2">
                {conversation.map((message) => (
                  <li
                    key={message.id}
                    className={
                      message.direction === 'inbound'
                        ? 'max-w-[85%] rounded-lg rounded-tl-sm bg-surface-2 px-3 py-2'
                        : 'ml-auto max-w-[85%] rounded-lg rounded-tr-sm px-3 py-2 text-white'
                    }
                    style={
                      message.direction === 'outbound' ? { background: 'var(--series-1)' } : undefined
                    }
                  >
                    <p className="text-xs whitespace-pre-line">{message.body}</p>
                    <p
                      className={
                        message.direction === 'inbound'
                          ? 'mt-1 text-[10px] text-muted'
                          : 'mt-1 text-[10px] text-white/70'
                      }
                    >
                      {formatDateTime(message.sentAt)}
                      {message.automatedBy ? ' · automatico' : ''}
                    </p>
                  </li>
                ))}
              </ol>
            </Card>
          ) : null}

          <Card>
            <SectionTitle title="Historial" hint="Todo lo que paso con este lead, en orden" />
            {timeline.length === 0 ? (
              <EmptyState title="Sin eventos" />
            ) : (
              <ol className="space-y-3">
                {timeline.map((entry) => (
                  <li key={entry.event.id} className="flex gap-3">
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: eventColor(entry.event.type) }}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1 border-b border-[var(--grid)] pb-3">
                      <p className="text-xs font-medium text-ink">
                        {eventLabel(entry.event.type, entry.event.payload)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted">
                        {formatDateTime(entry.event.occurredAt)}
                        {entry.content?.title ? ` · ${entry.content.title}` : ''}
                        {entry.event.valueCents !== 0
                          ? ` · ${formatMoney(entry.event.valueCents, org.currency)}`
                          : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={mono ? 'font-mono text-[11px] text-ink-2' : 'text-ink-2'}>{value}</dd>
    </div>
  );
}

function appointmentStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    scheduled: 'agendada',
    confirmed: 'confirmada',
    held: 'realizada',
    no_show: 'no asistio',
    canceled: 'cancelada',
    rescheduled: 'reprogramada',
  };
  return labels[status] ?? status;
}

function eventLabel(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case 'lead_created':
      return 'Lead creado';
    case 'comment_received':
      return `Comento: "${truncate(String(payload.text ?? ''))}"`;
    case 'dm_received':
      return `Mensaje recibido: "${truncate(String(payload.text ?? ''))}"`;
    case 'dm_sent':
      return `Mensaje enviado: "${truncate(String(payload.text ?? ''))}"`;
    case 'story_reply':
      return 'Respondio una story';
    case 'keyword_triggered':
      return `Palabra clave "${payload.word ?? ''}" disparada`;
    case 'resource_sent':
      return 'Recurso entregado por DM';
    case 'stage_changed':
      return `Etapa: ${payload.from ?? '—'} → ${payload.to ?? '—'}`;
    case 'meeting_booked':
      return 'Reunion agendada';
    case 'meeting_held':
      return 'Reunion realizada';
    case 'meeting_no_show':
      return 'No asistio a la reunion';
    case 'sale':
      return 'Venta cerrada';
    case 'refund':
      return 'Reembolso';
    case 'automation_run':
      return `Automatizacion: ${payload.automation ?? ''}`;
    case 'tag_added':
      return `Etiqueta agregada: ${(payload.tags as string[])?.join(', ') ?? ''}`;
    case 'field_updated':
      return 'Campos actualizados';
    default:
      return type;
  }
}

function eventColor(type: string): string {
  if (type === 'sale') return 'var(--good)';
  if (type === 'refund' || type === 'meeting_no_show') return 'var(--critical)';
  if (type === 'meeting_booked' || type === 'meeting_held') return 'var(--ramp-3)';
  if (type === 'keyword_triggered' || type === 'resource_sent') return 'var(--series-2)';
  return 'var(--axis)';
}

function truncate(text: string, length = 60): string {
  return text.length > length ? `${text.slice(0, length)}...` : text;
}
