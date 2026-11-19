/**
 * El token de la cuenta conectada es el que manda.
 *
 * Regresion: el cliente de Graph simulaba el envio siempre que faltara la
 * variable de entorno INSTAGRAM_ACCESS_TOKEN, aunque la cuenta estuviera
 * conectada por OAuth y su token viviera en la base. Resultado: conectabas
 * Instagram desde el asistente y los DMs no salian nunca, sin ningun error.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sendText } from '@/server/integrations/instagram';

const auth = { token: 'token-de-la-cuenta-conectada', igUserId: '17841400000000000' };

function stubFetch() {
  const fake = vi.fn(async () =>
    new Response(JSON.stringify({ message_id: 'mid.1' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fake);
  return fake;
}

describe('credenciales de salida', () => {
  beforeEach(() => {
    delete process.env.INSTAGRAM_ACCESS_TOKEN;
    delete process.env.DRY_RUN_OUTBOUND;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DRY_RUN_OUTBOUND;
  });

  it('sale a la red con el token de la cuenta aunque no haya variable de entorno', async () => {
    const fetchSpy = stubFetch();

    const result = await sendText(auth, { recipientIgId: '123', text: 'hola' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.dryRun).toBe(false);
    expect(result.ok).toBe(true);

    const [url, init] = fetchSpy.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain(`/${auth.igUserId}/messages`);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${auth.token}`);
  });

  it('simula cuando no hay ninguna credencial', async () => {
    const fetchSpy = stubFetch();

    const result = await sendText(
      { token: undefined as unknown as string, igUserId: 'me' },
      { recipientIgId: '123', text: 'hola' },
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
  });

  it('DRY_RUN_OUTBOUND=true frena el envio aunque haya token', async () => {
    process.env.DRY_RUN_OUTBOUND = 'true';
    const fetchSpy = stubFetch();

    const result = await sendText(auth, { recipientIgId: '123', text: 'hola' });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
  });
});
