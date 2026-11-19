import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** SHA-256 en hex. Se usa para guardar claves de API sin almacenarlas en claro. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Comparacion en tiempo constante: evita filtrar el secreto por tiempo de respuesta. */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verifica la firma de Meta: header `X-Hub-Signature-256: sha256=<hmac>`
 * calculado con el App Secret sobre el cuerpo crudo de la peticion.
 */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header) return false;
  const [algo, signature] = header.split('=');
  if (algo !== 'sha256' || !signature) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  return safeCompare(signature, expected);
}

/** HMAC-SHA256 genérico en hex, para webhooks propios y de terceros. */
export function hmacHex(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/**
 * Verifica y abre un `signed_request` de Meta.
 *
 * Es lo que Meta manda a las URLs de desautorizacion y de borrado de datos:
 * `base64url(firma).base64url(json)`, donde la firma es un HMAC-SHA256 del
 * SEGUNDO tramo tal cual viene, calculado con el App Secret. Si no se valida
 * la firma, cualquiera que sepa la URL puede desconectarle la cuenta al otro.
 *
 * Devuelve el payload o null si la firma no cierra.
 */
export function parseSignedRequest(
  signedRequest: string,
  appSecret: string,
): Record<string, unknown> | null {
  const [encodedSig, encodedPayload] = signedRequest.split('.');
  if (!encodedSig || !encodedPayload) return null;

  const expected = createHmac('sha256', appSecret).update(encodedPayload, 'utf8').digest();
  const received = Buffer.from(encodedSig.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  try {
    const json = Buffer.from(
      encodedPayload.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf8');
    const payload = JSON.parse(json) as Record<string, unknown>;
    // Meta solo firma con HMAC-SHA256; otro algoritmo es una señal de que algo
    // raro esta pasando, no algo que debamos aceptar por las dudas.
    if (payload.algorithm && String(payload.algorithm).toUpperCase() !== 'HMAC-SHA256') return null;
    return payload;
  } catch {
    return null;
  }
}
