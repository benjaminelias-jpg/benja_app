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
