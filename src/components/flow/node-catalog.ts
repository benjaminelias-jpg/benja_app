import type { AutomationStepType } from '@/db/schema';

/**
 * Catalogo de pasos del constructor de flujos.
 *
 * Cada tipo declara que campos necesita, y el inspector arma el formulario a
 * partir de eso. Agregar un paso nuevo es agregar una entrada aqui y un `case`
 * en el motor: no hay formularios escritos a mano por tipo.
 */

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'select'
  | 'tags'
  | 'conditions'
  | 'json'
  | 'media'
  | 'buttons';

export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
  help?: string;
  options?: Array<{ value: string; label: string }>;
}

export type NodeGroup = 'mensaje' | 'crm' | 'logica' | 'avanzado';

export interface NodeSpec {
  type: AutomationStepType;
  label: string;
  group: NodeGroup;
  description: string;
  fields: FieldSpec[];
  /** `branch` dibuja dos salidas (sí / no) en vez de una. */
  outputs: 'single' | 'branch';
}

export const GROUP_COLOR: Record<NodeGroup, string> = {
  mensaje: 'var(--series-1)',
  crm: 'var(--series-3)',
  logica: 'var(--series-2)',
  avanzado: 'var(--muted)',
};

export const GROUP_LABEL: Record<NodeGroup, string> = {
  mensaje: 'Mensajes',
  crm: 'CRM',
  logica: 'Lógica',
  avanzado: 'Avanzado',
};

const TEXT_HELP =
  'Variables: {{nombre}}, {{usuario}}, {{recurso}}, {{link}}, {{contenido}}, {{respuesta}}, {{campo.lo_que_sea}}';

export const NODE_SPECS: NodeSpec[] = [
  {
    type: 'send_dm',
    label: 'Enviar DM',
    group: 'mensaje',
    description: 'Manda un mensaje directo por Instagram.',
    outputs: 'single',
    fields: [
      { key: 'text', label: 'Mensaje', type: 'textarea', placeholder: 'Hola {{nombre}}!', help: TEXT_HELP },
    ],
  },
  {
    type: 'send_resource',
    label: 'Entregar recurso',
    group: 'mensaje',
    description: 'Manda el recurso asociado a la palabra clave que disparó el flujo.',
    outputs: 'single',
    fields: [
      {
        key: 'text',
        label: 'Mensaje',
        type: 'textarea',
        placeholder: 'Listo {{nombre}}, acá lo tenés: {{link}}',
        help: TEXT_HELP,
      },
    ],
  },
  {
    type: 'ask_question',
    label: 'Preguntar y esperar',
    group: 'mensaje',
    description:
      'Manda una pregunta y PAUSA el flujo. Sigue solo cuando el lead responde, y guarda su respuesta.',
    outputs: 'single',
    fields: [
      {
        key: 'text',
        label: 'Pregunta',
        type: 'textarea',
        placeholder: '¿Ya estás vendiendo o recién empezás?',
        help: TEXT_HELP,
      },
      {
        key: 'quickReplies',
        label: 'Botones de respuesta rápida',
        type: 'buttons',
        help: 'Hasta 13. Instagram corta los títulos a 20 caracteres. Sin botones, el lead responde en texto libre.',
      },
      {
        key: 'saveAs',
        label: 'Guardar respuesta en el campo',
        type: 'text',
        placeholder: 'facturacion',
        help: 'Después podés condicionar con campo.facturacion',
      },
    ],
  },
  {
    type: 'send_image',
    label: 'Enviar imagen',
    group: 'mensaje',
    description: 'Manda una imagen por DM. png o jpeg, hasta 8 MB.',
    outputs: 'single',
    fields: [{ key: 'url', label: 'Imagen', type: 'media', placeholder: 'image' }],
  },
  {
    type: 'send_audio',
    label: 'Enviar audio',
    group: 'mensaje',
    description: 'Manda una nota de voz o una pista de audio. aac, m4a, wav o mp4, hasta 25 MB.',
    outputs: 'single',
    fields: [{ key: 'url', label: 'Audio', type: 'media', placeholder: 'audio' }],
  },
  {
    type: 'send_video',
    label: 'Enviar video',
    group: 'mensaje',
    description: 'Manda un video por DM. mp4, ogg, avi, mov o webm, hasta 25 MB.',
    outputs: 'single',
    fields: [{ key: 'url', label: 'Video', type: 'media', placeholder: 'video' }],
  },
  {
    type: 'send_file',
    label: 'Enviar PDF',
    group: 'mensaje',
    description: 'Manda un archivo por DM. Instagram solo acepta PDF, hasta 25 MB.',
    outputs: 'single',
    fields: [{ key: 'url', label: 'Archivo', type: 'media', placeholder: 'file' }],
  },
  {
    type: 'typing',
    label: 'Mostrar "escribiendo..."',
    group: 'mensaje',
    description:
      'Muestra el indicador de escritura antes del próximo mensaje. Un flujo que responde al instante se nota automático.',
    outputs: 'single',
    fields: [
      {
        key: 'action',
        label: 'Acción',
        type: 'select',
        options: [
          { value: 'typing_on', label: 'Empezar a escribir' },
          { value: 'typing_off', label: 'Dejar de escribir' },
          { value: 'mark_seen', label: 'Marcar como visto' },
        ],
      },
    ],
  },
  {
    type: 'reply_comment',
    label: 'Responder comentario',
    group: 'mensaje',
    description: 'Contesta públicamente en el hilo del comentario que disparó el flujo.',
    outputs: 'single',
    fields: [
      { key: 'text', label: 'Respuesta', type: 'textarea', placeholder: 'Te lo mandé por DM 📩' },
    ],
  },
  {
    type: 'condition',
    label: 'Condición',
    group: 'logica',
    description: 'Bifurca el flujo. Lo que cumple va por "sí"; el resto por "no".',
    outputs: 'branch',
    fields: [
      { key: 'checks', label: 'Condiciones', type: 'conditions' },
      {
        key: 'match',
        label: 'Tienen que cumplirse',
        type: 'select',
        options: [
          { value: 'all', label: 'Todas' },
          { value: 'any', label: 'Al menos una' },
        ],
      },
    ],
  },
  {
    type: 'add_tag',
    label: 'Etiquetar',
    group: 'crm',
    description: 'Agrega etiquetas al lead (y las replica en ManyChat si está conectado).',
    outputs: 'single',
    fields: [{ key: 'tags', label: 'Etiquetas', type: 'tags', placeholder: 'calificado, interesado' }],
  },
  {
    type: 'remove_tag',
    label: 'Quitar etiqueta',
    group: 'crm',
    description: 'Saca etiquetas del lead.',
    outputs: 'single',
    fields: [{ key: 'tags', label: 'Etiquetas', type: 'tags' }],
  },
  {
    type: 'set_stage',
    label: 'Mover de etapa',
    group: 'crm',
    description: 'Lleva el lead a otra etapa del pipeline.',
    outputs: 'single',
    fields: [{ key: 'stageKey', label: 'Etapa', type: 'select', options: [] }],
  },
  {
    type: 'set_field',
    label: 'Escribir campo',
    group: 'crm',
    description: 'Guarda datos propios en el lead.',
    outputs: 'single',
    fields: [
      { key: 'fields', label: 'Campos (JSON)', type: 'json', placeholder: '{ "nivel": "avanzado" }' },
    ],
  },
  {
    type: 'assign_owner',
    label: 'Asignar responsable',
    group: 'crm',
    description: 'Le asigna el lead a alguien del equipo.',
    outputs: 'single',
    fields: [
      {
        key: 'strategy',
        label: 'Cómo asignar',
        type: 'select',
        options: [
          { value: 'round_robin', label: 'Reparto equitativo' },
          { value: 'fixed', label: 'Siempre a la misma persona' },
        ],
      },
      { key: 'ownerId', label: 'Persona', type: 'select', options: [] },
    ],
  },
  {
    type: 'create_appointment',
    label: 'Agendar reunión',
    group: 'crm',
    description: 'Crea una reunión atribuida al contenido que trajo al lead.',
    outputs: 'single',
    fields: [
      { key: 'title', label: 'Título', type: 'text', placeholder: 'Llamada de diagnóstico' },
      { key: 'scheduledAt', label: 'Fecha y hora (ISO)', type: 'text', placeholder: '2026-03-01T15:00:00Z' },
    ],
  },
  {
    type: 'create_deal',
    label: 'Registrar venta',
    group: 'crm',
    description: 'Cierra una venta y la acredita al contenido de origen.',
    outputs: 'single',
    fields: [
      { key: 'amountCents', label: 'Importe en centavos', type: 'number', placeholder: '149700' },
      { key: 'productId', label: 'Producto', type: 'select', options: [] },
    ],
  },
  {
    type: 'http_request',
    label: 'Llamar webhook',
    group: 'avanzado',
    description: 'Avisa a otra herramienta (Make, Zapier, tu backend) con los datos del lead.',
    outputs: 'single',
    fields: [
      { key: 'url', label: 'URL', type: 'text', placeholder: 'https://hook.make.com/…' },
      {
        key: 'method',
        label: 'Método',
        type: 'select',
        options: [
          { value: 'POST', label: 'POST' },
          { value: 'PUT', label: 'PUT' },
        ],
      },
    ],
  },
  {
    type: 'notify',
    label: 'Avisar al equipo',
    group: 'avanzado',
    description: 'Deja una nota en el registro de la ejecución.',
    outputs: 'single',
    fields: [{ key: 'message', label: 'Mensaje', type: 'text' }],
  },
  {
    type: 'wait',
    label: 'Esperar (no implementado)',
    group: 'avanzado',
    description:
      'Pausa por tiempo. Requiere un worker de cola: hoy queda registrado como omitido. Para esperar una respuesta usá "Preguntar y esperar".',
    outputs: 'single',
    fields: [{ key: 'minutes', label: 'Minutos', type: 'number' }],
  },
];

export const NODE_SPEC_BY_TYPE = new Map(NODE_SPECS.map((spec) => [spec.type, spec]));

export function specFor(type: AutomationStepType): NodeSpec {
  return (
    NODE_SPEC_BY_TYPE.get(type) ?? {
      type,
      label: type,
      group: 'avanzado',
      description: '',
      outputs: 'single',
      fields: [],
    }
  );
}

/** Campos sobre los que puede condicionar un nodo `condition`. */
export const CONDITION_FIELDS = [
  { value: 'respuesta', label: 'Última respuesta del lead' },
  { value: 'etiqueta', label: 'Etiquetas' },
  { value: 'origen', label: 'Origen del lead' },
  { value: 'seguidores', label: 'Cantidad de seguidores' },
  { value: 'email', label: 'Email' },
  { value: 'ingresos', label: 'Ingresos (centavos)' },
];

export const CONDITION_OPS = [
  { value: 'contains', label: 'contiene' },
  { value: 'not_contains', label: 'no contiene' },
  { value: 'equals', label: 'es igual a' },
  { value: 'exists', label: 'tiene algún valor' },
  { value: 'gt', label: 'es mayor que' },
  { value: 'lt', label: 'es menor que' },
];
