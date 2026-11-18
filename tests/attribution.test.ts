import { describe, it, expect } from 'vitest';
import { keywordMatches, normalizeKeyword } from '@/server/services/attribution';
import { parseAmountToCents, mapManychatEvent, normalizeManychat } from '@/server/integrations/manychat';
import { applyMapping, readPath } from '@/server/services/webhooks';
import { renderTemplate } from '@/server/services/automations';
import type { Lead } from '@/db/schema';

describe('coincidencia de keywords', () => {
  const quiero = { word: 'QUIERO', matchType: 'exact' as const };

  it('ignora mayusculas, acentos y signos', () => {
    expect(keywordMatches(quiero, 'quiero')).toBe(true);
    expect(keywordMatches(quiero, 'QUIERO!!!')).toBe(true);
    expect(keywordMatches({ word: 'GUIA', matchType: 'exact' }, 'guía')).toBe(true);
  });

  it('acepta la palabra dentro de una frase, que es como escribe la gente', () => {
    expect(keywordMatches(quiero, 'hola quiero porfa')).toBe(true);
    expect(keywordMatches(quiero, 'QUIERO 🙏 gracias')).toBe(true);
  });

  it('no coincide cuando la palabra esta pegada a otra', () => {
    expect(keywordMatches(quiero, 'noquierogracias')).toBe(false);
    expect(keywordMatches(quiero, 'requieroayuda')).toBe(false);
  });

  it('respeta los otros modos de coincidencia', () => {
    expect(keywordMatches({ word: 'info', matchType: 'contains' }, 'dame informacion')).toBe(true);
    expect(keywordMatches({ word: 'info', matchType: 'starts_with' }, 'info por favor')).toBe(true);
    expect(keywordMatches({ word: 'info', matchType: 'starts_with' }, 'dame info')).toBe(false);
    expect(keywordMatches({ word: '^\\d{4}$', matchType: 'regex' }, '2026')).toBe(true);
  });

  it('no explota con una expresion regular invalida', () => {
    expect(keywordMatches({ word: '([a-z', matchType: 'regex' }, 'texto')).toBe(false);
  });

  it('normaliza emojis y espacios multiples', () => {
    expect(normalizeKeyword('  HOLA   🔥 Qué tal ')).toBe('hola que tal');
  });
});

describe('importes', () => {
  it('convierte distintos formatos a centavos', () => {
    expect(parseAmountToCents(197)).toBe(19_700);
    expect(parseAmountToCents('197')).toBe(19_700);
    expect(parseAmountToCents('197.50')).toBe(19_750);
    expect(parseAmountToCents('$1.497,00')).toBe(149_700);
    expect(parseAmountToCents('USD 2 997')).toBe(299_700);
  });

  it('devuelve null cuando no hay importe', () => {
    expect(parseAmountToCents(null)).toBeNull();
    expect(parseAmountToCents('')).toBeNull();
    expect(parseAmountToCents('gratis')).toBeNull();
  });
});

describe('eventos de ManyChat', () => {
  it('traduce los nombres que usa la gente en espanol', () => {
    expect(mapManychatEvent('venta')).toBe('sale');
    expect(mapManychatEvent('Compra')).toBe('sale');
    expect(mapManychatEvent('reu')).toBe('meeting');
    expect(mapManychatEvent('reunion agendada'.replace(' agendada', ''))).toBe('meeting');
    expect(mapManychatEvent('no_show')).toBe('no_show');
    expect(mapManychatEvent('cualquier cosa')).toBe('custom');
  });

  it('normaliza un payload tipico de ManyChat', () => {
    const result = normalizeManychat({
      subscriber_id: 987654,
      ig_username: '@camila.rossi',
      first_name: 'Camila',
      last_name: 'Rossi',
      event: 'VENTA',
      amount: '1497',
      currency: 'USD',
      ig_media_id: '17841400000000001',
      tags: 'cliente, high-ticket',
    });

    expect(result.subscriberId).toBe('987654');
    expect(result.igUsername).toBe('camila.rossi');
    expect(result.fullName).toBe('Camila Rossi');
    expect(result.amountCents).toBe(149_700);
    expect(result.igMediaId).toBe('17841400000000001');
    expect(result.tags).toEqual(['cliente', 'high-ticket']);
  });
});

describe('mapeo de webhooks genericos', () => {
  const calendly = {
    payload: {
      invitee: { email: 'Camila@Mail.com', name: 'Camila Rossi' },
      event: { start_time: '2026-03-01T15:00:00Z', uri: 'https://api.calendly.com/ev/abc' },
    },
  };

  it('lee rutas anidadas', () => {
    expect(readPath(calendly, 'payload.invitee.email')).toBe('Camila@Mail.com');
    expect(readPath(calendly, 'payload.invitee.inexistente')).toBeUndefined();
    expect(readPath({ list: [{ id: 7 }] }, 'list.0.id')).toBe(7);
  });

  it('aplica el mapeo y respeta los literales con =', () => {
    const mapped = applyMapping(
      {
        kind: '=meeting',
        email: 'payload.invitee.email',
        scheduledAt: 'payload.event.start_time',
        externalId: 'payload.event.uri',
      },
      calendly,
    );

    expect(mapped).toEqual({
      kind: 'meeting',
      email: 'Camila@Mail.com',
      scheduledAt: '2026-03-01T15:00:00Z',
      externalId: 'https://api.calendly.com/ev/abc',
    });
  });

  it('omite campos que no existen en el payload', () => {
    const mapped = applyMapping({ phone: 'payload.invitee.phone' }, calendly);
    expect(mapped).toEqual({});
  });
});

describe('plantillas de automatizacion', () => {
  const lead = { fullName: 'Camila Rossi', igUsername: 'camila.rossi', email: null } as Lead;

  it('usa el primer nombre, que es como se escribe un DM', () => {
    const text = renderTemplate('Hola {{nombre}}, aca va {{recurso}}: {{link}}', {
      orgId: 'org_1',
      lead,
      keyword: { resourceName: 'la guia', resourceUrl: 'https://x.com/g' } as never,
    });
    expect(text).toBe('Hola Camila, aca va la guia: https://x.com/g');
  });

  it('tiene una variable aparte para el nombre completo', () => {
    const text = renderTemplate('Para: {{nombrecompleto}}', { orgId: 'org_1', lead });
    expect(text).toBe('Para: Camila Rossi');
  });

  it('deja intactas las variables que no conoce', () => {
    const text = renderTemplate('Hola {{nombre}} {{desconocida}}', { orgId: 'org_1', lead });
    expect(text).toBe('Hola Camila {{desconocida}}');
  });

  it('lee campos personalizados del lead', () => {
    const text = renderTemplate('Facturas: {{campo.facturacion}}', {
      orgId: 'org_1',
      lead: { ...lead, customFields: { facturacion: '3k' } } as never,
    });
    expect(text).toBe('Facturas: 3k');
  });
});
