'use client';

import { useCallback, useMemo, useState, useTransition } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  Panel,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { StepNode, TriggerNode, type FlowNodeData } from './flow-node';
import { Inspector, type InspectorOptions } from './inspector';
import { NODE_SPECS, GROUP_COLOR, GROUP_LABEL, specFor, type NodeGroup } from './node-catalog';
import { saveFlowAction, testFlowAction, type FlowNodePayload, type TestResult } from '@/app/automatizaciones/actions';
import type { AutomationStepType } from '@/db/schema';

export interface InitialStep {
  nodeId: string;
  type: AutomationStepType;
  config: Record<string, unknown>;
  x: number;
  y: number;
  next: string | null;
  branches: Array<{ when: string; goTo: string }>;
}

const nodeTypes = { step: StepNode, trigger: TriggerNode };

const TRIGGER_ID = '__trigger__';

/**
 * Constructor visual de flujos.
 *
 * El lienzo es la fuente de verdad mientras se edita; al guardar se traduce a
 * filas de `automation_steps` (nodo → paso, arista → `nextNodeId` o rama).
 * Nada se guarda solo: editar un flujo activo sin querer es peor que tener que
 * apretar "Guardar".
 */
export function FlowBuilder(props: {
  automationId: string;
  name: string;
  triggerLabel: string;
  triggerHint: string;
  initialSteps: InitialStep[];
  options: InspectorOptions;
}) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}

function Canvas({
  automationId,
  triggerLabel,
  triggerHint,
  initialSteps,
  options,
}: {
  automationId: string;
  name: string;
  triggerLabel: string;
  triggerHint: string;
  initialSteps: InitialStep[];
  options: InspectorOptions;
}) {
  const { initialNodes, initialEdges } = useMemo(
    () => buildGraph(initialSteps, triggerLabel, triggerHint),
    [initialSteps, triggerLabel, triggerHint],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = nodes.find((node) => node.id === selectedId && node.type === 'step');

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) => {
        // Una salida lleva a un solo lugar: conectar de nuevo reemplaza.
        const cleaned = current.filter(
          (edge) =>
            !(edge.source === connection.source && (edge.sourceHandle ?? null) === (connection.sourceHandle ?? null)),
        );
        return addEdge({ ...connection, ...edgeStyle(connection.sourceHandle) }, cleaned);
      });
      setDirty(true);
    },
    [setEdges],
  );

  function addNode(type: AutomationStepType) {
    const nodeId = `n_${Math.random().toString(36).slice(2, 10)}`;
    const lowest = nodes.reduce((max, node) => Math.max(max, node.position.y), 0);
    setNodes((current) => [
      ...current,
      {
        id: nodeId,
        type: 'step',
        position: { x: 120, y: lowest + 150 },
        data: { stepType: type, config: defaultConfig(type) } satisfies FlowNodeData,
      } as Node,
    ]);
    setSelectedId(nodeId);
    setDirty(true);
  }

  function updateConfig(nodeId: string, config: Record<string, unknown>) {
    setNodes((current) =>
      current.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, config } } : node,
      ),
    );
    setDirty(true);
  }

  function deleteNode(nodeId: string) {
    setNodes((current) => current.filter((node) => node.id !== nodeId));
    setEdges((current) => current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId));
    setSelectedId(null);
    setDirty(true);
  }

  function save() {
    const payload = toPayload(nodes, edges);
    startTransition(async () => {
      setMessage(null);
      const result = await saveFlowAction(automationId, payload);
      if (result.ok) {
        setDirty(false);
        setMessage({ kind: 'ok', text: `Guardado: ${result.saved} pasos.` });
      } else {
        setMessage({ kind: 'error', text: result.error ?? 'No se pudo guardar.' });
      }
    });
  }

  function runTest() {
    startTransition(async () => {
      setTest(null);
      setMessage(null);
      if (dirty) {
        const result = await saveFlowAction(automationId, toPayload(nodes, edges));
        if (!result.ok) {
          setMessage({ kind: 'error', text: result.error ?? 'No se pudo guardar antes de probar.' });
          return;
        }
        setDirty(false);
      }
      setTest(await testFlowAction(automationId, 'ya facturo unos 3k al mes'));
    });
  }

  return (
    <div className="flex h-full min-h-0">
      {/* Paleta */}
      <aside className="scroll-thin w-[190px] shrink-0 overflow-y-auto border-r border-[var(--border)] bg-surface px-3 py-3">
        <p className="mb-2 text-[11px] font-medium text-muted">Agregar paso</p>
        {(['mensaje', 'logica', 'crm', 'avanzado'] as NodeGroup[]).map((group) => (
          <div key={group} className="mb-3">
            <p className="mb-1 text-[10px] uppercase tracking-wide text-muted">{GROUP_LABEL[group]}</p>
            <div className="space-y-1">
              {NODE_SPECS.filter((spec) => spec.group === group).map((spec) => (
                <button
                  key={spec.type}
                  type="button"
                  onClick={() => addNode(spec.type)}
                  title={spec.description}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] text-ink-2 hover:bg-surface-2 hover:text-ink"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: GROUP_COLOR[spec.group] }}
                    aria-hidden
                  />
                  <span className="truncate">{spec.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </aside>

      {/* Lienzo */}
      <div className="relative min-w-0 flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={(changes) => {
            onNodesChange(changes);
            // React Flow 13 entrega un Changeset, no un array: se consulta por tipo.
            // Solo mover o borrar ensucia el flujo; seleccionar no.
            if (
              changes.getByType('position').length > 0 ||
              changes.getByType('remove').length > 0 ||
              changes.getByType('add').length > 0
            ) {
              setDirty(true);
            }
          }}
          onEdgesChange={(changes) => {
            onEdgesChange(changes);
            if (changes.getByType('remove').length > 0) setDirty(true);
          }}
          onConnect={onConnect}
          onNodeClick={(_event, node) => setSelectedId(node.type === 'step' ? node.id : null)}
          onPaneClick={() => setSelectedId(null)}
          nodeTypes={nodeTypes}
          fitView
          proOptions={{ hideAttribution: false }}
          defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed } }}
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="var(--grid)" />
          <Controls showInteractive={false} />

          <Panel position="top-right" className="flex items-center gap-2">
            {message ? (
              <span
                className="rounded-lg bg-surface px-2.5 py-1.5 text-[11px] hairline"
                style={{ color: message.kind === 'ok' ? 'var(--good-text)' : 'var(--critical)' }}
              >
                {message.text}
              </span>
            ) : null}
            <button
              type="button"
              onClick={runTest}
              disabled={pending}
              className="rounded-lg bg-surface px-3 py-1.5 text-xs font-medium text-ink-2 hairline hover:text-ink disabled:opacity-50"
            >
              Probar
            </button>
            <button
              type="button"
              onClick={save}
              disabled={pending || !dirty}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              style={{ background: 'var(--series-1)' }}
            >
              {pending ? 'Guardando…' : dirty ? 'Guardar' : 'Guardado'}
            </button>
          </Panel>
        </ReactFlow>

        {test ? (
          <div className="absolute bottom-4 left-4 max-h-[46%] w-[380px] overflow-hidden rounded-xl bg-surface shadow-lg hairline">
            <header className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2">
              <span className="text-xs font-semibold text-ink">
                Prueba en seco {test.leadName ? `· ${test.leadName}` : ''}
              </span>
              <button type="button" onClick={() => setTest(null)} className="text-xs text-muted hover:text-ink">
                Cerrar
              </button>
            </header>
            <div className="scroll-thin max-h-[220px] overflow-y-auto px-3 py-2">
              {test.error ? (
                <p className="text-xs" style={{ color: 'var(--critical)' }}>
                  {test.error}
                </p>
              ) : (
                <ol className="space-y-1.5">
                  {(test.steps ?? []).map((step, index) => (
                    <li key={index} className="flex gap-2 text-[11px]">
                      <span
                        className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{
                          background:
                            step.status === 'failed'
                              ? 'var(--critical)'
                              : step.status === 'skipped'
                                ? 'var(--warning)'
                                : step.status === 'waiting'
                                  ? 'var(--ramp-3)'
                                  : 'var(--good)',
                        }}
                        aria-hidden
                      />
                      <span className="min-w-0">
                        <span className="font-medium text-ink">{specFor(step.type as AutomationStepType).label}</span>
                        <span className="text-muted"> · {step.status}</span>
                        {step.detail ? <span className="block text-muted">{step.detail}</span> : null}
                      </span>
                    </li>
                  ))}
                  {(test.steps ?? []).length === 0 ? (
                    <li className="text-[11px] text-muted">El flujo no ejecutó ningún paso.</li>
                  ) : null}
                </ol>
              )}
            </div>
            <footer className="border-t border-[var(--border)] px-3 py-2 text-[10px] text-muted">
              No se envió nada ni se modificó ningún lead.
            </footer>
          </div>
        ) : null}
      </div>

      {/* Inspector */}
      <aside className="w-[300px] shrink-0 border-l border-[var(--border)] bg-surface">
        {selected ? (
          <Inspector
            stepType={(selected.data as FlowNodeData).stepType}
            config={(selected.data as FlowNodeData).config}
            onChange={(config) => updateConfig(selected.id, config)}
            onDelete={() => deleteNode(selected.id)}
            options={options}
          />
        ) : (
          <div className="px-4 py-6">
            <p className="text-sm font-medium text-ink">Elegí un paso</p>
            <p className="mt-1.5 text-xs text-ink-2">
              Hacé clic en un paso del lienzo para configurarlo, o agregá uno nuevo desde la
              izquierda.
            </p>
            <p className="mt-4 text-[11px] text-muted">
              Arrastrá desde el punto de abajo de un paso hasta el de arriba del siguiente para
              conectarlos. Un paso de <strong>condición</strong> tiene dos salidas: sí y no.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Traduccion entre la base y el lienzo
 * ------------------------------------------------------------------ */

function buildGraph(steps: InitialStep[], triggerLabel: string, triggerHint: string) {
  const initialNodes: Node[] = [
    {
      id: TRIGGER_ID,
      type: 'trigger',
      position: { x: 80, y: -120 },
      data: { label: triggerLabel, hint: triggerHint },
      deletable: false,
    } as Node,
    ...steps.map(
      (step) =>
        ({
          id: step.nodeId,
          type: 'step',
          position: { x: step.x, y: step.y },
          data: { stepType: step.type, config: step.config } satisfies FlowNodeData,
        }) as Node,
    ),
  ];

  const initialEdges: Edge[] = [];

  if (steps[0]) {
    initialEdges.push({
      id: `e_trigger`,
      source: TRIGGER_ID,
      target: steps[0].nodeId,
      ...edgeStyle(null),
    });
  }

  for (const step of steps) {
    if (step.next) {
      initialEdges.push({
        id: `e_${step.nodeId}_next`,
        source: step.nodeId,
        sourceHandle: 'next',
        target: step.next,
        ...edgeStyle('next'),
      });
    }
    for (const branch of step.branches ?? []) {
      if (!branch.goTo) continue;
      initialEdges.push({
        id: `e_${step.nodeId}_${branch.when}`,
        source: step.nodeId,
        sourceHandle: branch.when,
        target: branch.goTo,
        label: branch.when === 'true' ? 'sí' : 'no',
        ...edgeStyle(branch.when),
      });
    }
  }

  return { initialNodes, initialEdges };
}

function edgeStyle(handle: string | null | undefined) {
  const color =
    handle === 'true' ? 'var(--good)' : handle === 'false' ? 'var(--critical)' : 'var(--axis)';
  return {
    style: { stroke: color, strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, color },
    animated: false,
  };
}

/** Lienzo → filas. El orden sigue el recorrido desde el disparador. */
function toPayload(nodes: Node[], edges: Edge[]): FlowNodePayload[] {
  const stepNodes = nodes.filter((node) => node.type === 'step');

  const payload = stepNodes.map((node) => {
    const data = node.data as FlowNodeData;
    const spec = specFor(data.stepType);

    const outgoing = edges.filter((edge) => edge.source === node.id);
    const branches =
      spec.outputs === 'branch'
        ? outgoing
            .filter((edge) => edge.sourceHandle === 'true' || edge.sourceHandle === 'false')
            .map((edge) => ({ when: String(edge.sourceHandle), goTo: edge.target }))
        : [];

    const next =
      spec.outputs === 'branch'
        ? null
        : (outgoing.find((edge) => edge.sourceHandle !== 'true' && edge.sourceHandle !== 'false')
            ?.target ?? null);

    return {
      nodeId: node.id,
      type: data.stepType,
      config: data.config,
      x: node.position.x,
      y: node.position.y,
      next,
      branches,
    } satisfies FlowNodePayload;
  });

  // El primer paso debe ser el que cuelga del disparador: el motor arranca por
  // el de menor posicion, no por el que quedo mas arriba en el lienzo.
  const firstId = edges.find((edge) => edge.source === TRIGGER_ID)?.target;
  if (firstId) {
    const index = payload.findIndex((item) => item.nodeId === firstId);
    if (index > 0) {
      const [first] = payload.splice(index, 1);
      payload.unshift(first);
    }
  }

  return payload;
}

function defaultConfig(type: AutomationStepType): Record<string, unknown> {
  switch (type) {
    case 'send_dm':
      return { text: 'Hola {{nombre}}!' };
    case 'send_resource':
      return { text: 'Listo {{nombre}}, acá lo tenés: {{link}}' };
    case 'ask_question':
      return { text: '¿Ya estás vendiendo o recién empezás?', saveAs: 'respuesta' };
    case 'reply_comment':
      return { text: 'Te lo mandé por DM 📩' };
    case 'condition':
      return { checks: [{ field: 'respuesta', op: 'contains', value: '' }], match: 'all' };
    case 'assign_owner':
      return { strategy: 'round_robin' };
    case 'http_request':
      return { method: 'POST' };
    case 'wait':
      return { minutes: 60 };
    default:
      return {};
  }
}
