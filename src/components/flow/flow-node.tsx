'use client';

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import clsx from 'clsx';
import { GROUP_COLOR, specFor } from './node-catalog';
import type { AutomationStepType } from '@/db/schema';

export type FlowNodeData = {
  stepType: AutomationStepType;
  config: Record<string, unknown>;
  selected?: boolean;
};

export type FlowNode = Node<FlowNodeData, 'step'>;

/** Resumen de una linea de lo que hace el paso, para leer el flujo de un vistazo. */
export function summarize(type: AutomationStepType, config: Record<string, unknown>): string {
  switch (type) {
    case 'send_dm':
    case 'send_resource':
    case 'reply_comment':
      return String(config.text ?? '').slice(0, 90) || 'Sin texto';
    case 'ask_question': {
      const buttons = (config.quickReplies as Array<{ title?: string }>) ?? [];
      const text = String(config.text ?? '').slice(0, 70) || 'Sin texto';
      return buttons.length > 0
        ? `${text}\n[${buttons.map((b) => b.title).filter(Boolean).join('] [')}]`
        : text;
    }
    case 'send_image':
    case 'send_audio':
    case 'send_video':
    case 'send_file': {
      const url = String(config.url ?? '');
      if (!url) return 'Sin archivo';
      return url.split('/').pop()?.slice(0, 40) ?? url;
    }
    case 'typing':
      return String(config.action ?? 'typing_on');
    case 'add_tag':
    case 'remove_tag':
      return Array.isArray(config.tags) ? config.tags.join(', ') : String(config.tags ?? '');
    case 'set_stage':
      return `→ ${config.stageKey ?? 'elegir etapa'}`;
    case 'set_field':
      return Object.keys((config.fields as object) ?? {}).join(', ') || 'Sin campos';
    case 'assign_owner':
      return config.strategy === 'round_robin' ? 'reparto equitativo' : 'persona fija';
    case 'create_appointment':
      return String(config.title ?? 'Llamada');
    case 'create_deal':
      return `${Number(config.amountCents ?? 0) / 100} de venta`;
    case 'http_request':
      return String(config.url ?? 'Sin URL');
    case 'wait':
      return `${config.minutes ?? 0} min`;
    case 'condition': {
      const checks = (config.checks as Array<{ field?: string }>) ?? [];
      return checks.length === 0
        ? 'Sin condiciones'
        : `${checks.length} ${checks.length === 1 ? 'condición' : 'condiciones'}`;
    }
    default:
      return '';
  }
}

export function StepNode({ data, selected }: NodeProps<FlowNode>) {
  const spec = specFor(data.stepType);
  const color = GROUP_COLOR[spec.group];
  const isBranch = spec.outputs === 'branch';

  return (
    <div
      className={clsx(
        'w-[230px] rounded-xl bg-surface text-left shadow-sm transition-shadow',
        selected ? 'shadow-md' : '',
      )}
      style={{
        border: `1px solid ${selected ? color : 'var(--border)'}`,
        // El anillo de 2px separa el nodo del fondo del canvas cuando se superponen.
        boxShadow: selected ? `0 0 0 2px var(--surface-1), 0 0 0 3px ${color}` : undefined,
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: 'var(--axis)', width: 8, height: 8, border: '2px solid var(--surface-1)' }}
      />

      <header className="flex items-center gap-2 rounded-t-xl px-3 py-2" style={{ background: 'var(--surface-2)' }}>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
        <span className="truncate text-xs font-semibold text-ink">{spec.label}</span>
      </header>

      <p className="line-clamp-3 px-3 py-2 text-[11px] text-ink-2">
        {summarize(data.stepType, data.config)}
      </p>

      {isBranch ? (
        <div className="flex justify-between px-3 pb-2 text-[10px] font-medium">
          <span style={{ color: 'var(--good-text)' }}>sí ↓</span>
          <span style={{ color: 'var(--critical)' }}>no ↓</span>
        </div>
      ) : null}

      {isBranch ? (
        <>
          <Handle
            id="true"
            type="source"
            position={Position.Bottom}
            style={{
              left: '28%',
              background: 'var(--good)',
              width: 9,
              height: 9,
              border: '2px solid var(--surface-1)',
            }}
          />
          <Handle
            id="false"
            type="source"
            position={Position.Bottom}
            style={{
              left: '72%',
              background: 'var(--critical)',
              width: 9,
              height: 9,
              border: '2px solid var(--surface-1)',
            }}
          />
        </>
      ) : (
        <Handle
          id="next"
          type="source"
          position={Position.Bottom}
          style={{ background: color, width: 9, height: 9, border: '2px solid var(--surface-1)' }}
        />
      )}
    </div>
  );
}

/** Nodo de entrada: representa el disparador, no se puede borrar ni mover de lugar lógico. */
export function TriggerNode({ data }: NodeProps<Node<{ label: string; hint: string }, 'trigger'>>) {
  return (
    <div
      className="w-[230px] rounded-xl px-3 py-2.5 text-white shadow-sm"
      style={{ background: 'var(--ramp-4)' }}
    >
      <p className="text-[10px] uppercase tracking-wide text-white/70">Disparador</p>
      <p className="mt-0.5 text-xs font-semibold">{data.label}</p>
      <p className="mt-0.5 text-[11px] text-white/80">{data.hint}</p>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: 'var(--ramp-4)', width: 9, height: 9, border: '2px solid var(--surface-1)' }}
      />
    </div>
  );
}
