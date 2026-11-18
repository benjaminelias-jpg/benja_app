import { customAlphabet } from 'nanoid';

// Alfabeto sin caracteres ambiguos (0/O, 1/l) para IDs que se copian a mano.
const alphabet = '23456789abcdefghijkmnpqrstuvwxyz';
const nano = customAlphabet(alphabet, 14);

/** IDs legibles con prefijo de entidad: `lead_7g2k...`. Facilita depurar logs y webhooks. */
export function newId(prefix: string): string {
  return `${prefix}_${nano()}`;
}

/** Token aleatorio URL-safe para secretos de webhook y claves de API. */
export function randomToken(length = 32): string {
  return customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', length)();
}

/** Convierte un texto en slug: "Mi Reel de Ventas!" -> "mi-reel-de-ventas". */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
