'use client';

import { useTransition } from 'react';
import { moveLeadAction } from '@/app/actions';

/**
 * Selector de etapa. Al cambiar, envia la accion de servidor y revalida.
 * Es la forma mas accesible de mover un lead: funciona con teclado y sin
 * arrastrar, y sigue siendo un click.
 */
export function StageSelect({
  leadId,
  stageId,
  stages,
  compact = false,
}: {
  leadId: string;
  stageId: string | null;
  stages: Array<{ id: string; name: string }>;
  compact?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      aria-label="Etapa del lead"
      defaultValue={stageId ?? ''}
      disabled={pending}
      onChange={(event) => {
        const formData = new FormData();
        formData.set('leadId', leadId);
        formData.set('stageId', event.target.value);
        startTransition(() => {
          void moveLeadAction(formData);
        });
      }}
      className={
        compact
          ? 'w-full rounded-md bg-surface-2 px-1.5 py-1 text-[11px] text-ink-2 hairline'
          : 'rounded-lg bg-surface px-2.5 py-1.5 text-xs text-ink hairline'
      }
    >
      {stages.map((stage) => (
        <option key={stage.id} value={stage.id}>
          {stage.name}
        </option>
      ))}
    </select>
  );
}
