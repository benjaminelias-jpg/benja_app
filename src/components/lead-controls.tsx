'use client';

import { useRef, useTransition } from 'react';
import { assignOwnerAction, addTagAction } from '@/app/actions';

export function OwnerSelect({
  leadId,
  ownerId,
  users,
}: {
  leadId: string;
  ownerId: string | null;
  users: Array<{ id: string; name: string }>;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <select
      aria-label="Responsable del lead"
      defaultValue={ownerId ?? ''}
      disabled={pending}
      onChange={(event) => {
        const formData = new FormData();
        formData.set('leadId', leadId);
        formData.set('ownerId', event.target.value);
        startTransition(() => {
          void assignOwnerAction(formData);
        });
      }}
      className="rounded-lg bg-surface px-2.5 py-1.5 text-xs text-ink hairline"
    >
      <option value="">Sin responsable</option>
      {users.map((user) => (
        <option key={user.id} value={user.id}>
          {user.name}
        </option>
      ))}
    </select>
  );
}

export function TagInput({ leadId }: { leadId: string }) {
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={async (formData: FormData) => {
        await addTagAction(formData);
        formRef.current?.reset();
      }}
      className="flex gap-2"
    >
      <input type="hidden" name="leadId" value={leadId} />
      <input
        name="tag"
        placeholder="Nueva etiqueta"
        aria-label="Nueva etiqueta"
        className="h-8 min-w-0 flex-1 rounded-lg bg-surface-2 px-2.5 text-xs text-ink hairline placeholder:text-muted"
      />
      <button
        type="submit"
        className="h-8 shrink-0 rounded-lg px-2.5 text-xs font-medium text-white"
        style={{ background: 'var(--series-1)' }}
      >
        Agregar
      </button>
    </form>
  );
}
