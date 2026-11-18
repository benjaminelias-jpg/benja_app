'use client';

import { useState } from 'react';
import { Card, SectionTitle, Table, Th, Td, EmptyState } from '@/components/ui';
import { createKeywordAction, deleteKeywordAction } from '@/app/automatizaciones/actions';
import { formatNumber } from '@/lib/format';

export interface KeywordRow {
  id: string;
  word: string;
  channel: string;
  contentTitle: string | null;
  resourceName: string | null;
  triggers: number;
  leads: number;
}

/**
 * Alta y baja de palabras clave.
 *
 * Es el punto donde se ata un contenido con un flujo: sin keyword, los leads
 * que lleguen por ese reel no se pueden atribuir.
 */
export function KeywordManager({
  keywords,
  contents,
  automations,
}: {
  keywords: KeywordRow[];
  contents: Array<{ id: string; title: string }>;
  automations: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Card>
      <SectionTitle
        title="Palabras clave"
        hint="Cada palabra ata un contenido con el flujo que se dispara y el recurso que entrega"
        action={
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-ink-2 hairline hover:text-ink"
          >
            {open ? 'Cancelar' : 'Nueva palabra'}
          </button>
        }
      />

      {open ? (
        <form
          action={createKeywordAction}
          className="mb-4 grid gap-2 rounded-xl bg-surface-2 p-3 hairline sm:grid-cols-2 lg:grid-cols-3"
        >
          <Field label="Palabra">
            <input
              name="word"
              required
              placeholder="GUION"
              className="h-9 w-full rounded-lg bg-surface px-2.5 text-sm text-ink hairline"
            />
          </Field>

          <Field label="Coincidencia">
            <select name="matchType" defaultValue="exact" className="h-9 w-full rounded-lg bg-surface px-2.5 text-sm text-ink hairline">
              <option value="exact">Palabra completa</option>
              <option value="contains">La contiene</option>
              <option value="starts_with">Empieza con</option>
              <option value="regex">Expresión regular</option>
            </select>
          </Field>

          <Field label="Dónde escucha">
            <select name="channel" defaultValue="ig_comment" className="h-9 w-full rounded-lg bg-surface px-2.5 text-sm text-ink hairline">
              <option value="ig_comment">Comentario</option>
              <option value="ig_dm">Mensaje directo</option>
              <option value="ig_story">Respuesta a story</option>
            </select>
          </Field>

          <Field label="Contenido">
            <select name="contentId" className="h-9 w-full rounded-lg bg-surface px-2.5 text-sm text-ink hairline">
              <option value="">Sin contenido (cualquiera)</option>
              {contents.map((content) => (
                <option key={content.id} value={content.id}>
                  {content.title.slice(0, 50)}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Flujo a disparar">
            <select name="automationId" className="h-9 w-full rounded-lg bg-surface px-2.5 text-sm text-ink hairline">
              <option value="">Ninguno</option>
              {automations.map((automation) => (
                <option key={automation.id} value={automation.id}>
                  {automation.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Link del recurso">
            <input
              name="resourceUrl"
              placeholder="https://…"
              className="h-9 w-full rounded-lg bg-surface px-2.5 text-sm text-ink hairline"
            />
          </Field>

          <div className="sm:col-span-2 lg:col-span-3">
            <button
              type="submit"
              className="h-9 rounded-lg px-3 text-sm font-medium text-white"
              style={{ background: 'var(--series-1)' }}
            >
              Crear palabra clave
            </button>
          </div>
        </form>
      ) : null}

      {keywords.length === 0 ? (
        <EmptyState title="Sin palabras clave" hint="Sin ellas, los leads entran sin contenido atribuido." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Palabra</Th>
              <Th>Canal</Th>
              <Th>Contenido</Th>
              <Th>Recurso</Th>
              <Th align="right">Disparos</Th>
              <Th align="right">Leads</Th>
              <Th align="right">—</Th>
            </tr>
          </thead>
          <tbody>
            {keywords.map((keyword) => (
              <tr key={keyword.id}>
                <Td>
                  <span className="font-mono text-xs font-medium text-ink">{keyword.word}</span>
                </Td>
                <Td>
                  <span className="text-xs">{keyword.channel === 'ig_comment' ? 'Comentario' : 'DM'}</span>
                </Td>
                <Td>
                  <span className="line-clamp-1 text-xs">{keyword.contentTitle ?? '—'}</span>
                </Td>
                <Td>
                  <span className="line-clamp-1 text-xs text-muted">{keyword.resourceName ?? '—'}</span>
                </Td>
                <Td align="right">{formatNumber(keyword.triggers)}</Td>
                <Td align="right">{formatNumber(keyword.leads)}</Td>
                <Td align="right">
                  <form action={deleteKeywordAction}>
                    <input type="hidden" name="keywordId" value={keyword.id} />
                    <button type="submit" className="text-[11px] text-muted hover:text-ink">
                      Borrar
                    </button>
                  </form>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-muted">{label}</span>
      {children}
    </label>
  );
}
