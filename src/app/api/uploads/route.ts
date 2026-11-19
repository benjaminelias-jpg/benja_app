import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { getCurrentOrg } from '@/server/context';
import { MEDIA_LIMITS, mediaTypeFromUrl, type MediaType } from '@/server/integrations/instagram';
import { newId } from '@/lib/ids';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Sube un archivo y devuelve su URL publica.
 *
 * Instagram no recibe bytes: recibe una URL que Meta va a descargar. Por eso un
 * adjunto necesita estar alojado en algun lado antes de poder mandarse, y por
 * eso existe este endpoint.
 */
export async function POST(request: NextRequest) {
  await getCurrentOrg();

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      {
        error:
          'No hay almacenamiento configurado. Conectá un Blob store al proyecto, o pegá directamente la URL pública del archivo.',
      },
      { status: 501 },
    );
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Falta el archivo.' }, { status: 400 });
  }

  const declared = String(form?.get('type') ?? '') as MediaType;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const type: MediaType =
    declared && declared in MEDIA_LIMITS ? declared : (mediaTypeFromUrl(file.name) ?? 'file');

  const limits = MEDIA_LIMITS[type];

  // Se valida ANTES de subir: no tiene sentido gastar almacenamiento en un
  // archivo que Instagram va a rechazar igual.
  if (!limits.extensions.includes(extension)) {
    return NextResponse.json(
      {
        error: `Para ${limits.label} Instagram acepta ${limits.extensions.join(', ')}. Este archivo es .${extension}.`,
      },
      { status: 422 },
    );
  }

  if (file.size > limits.maxBytes) {
    return NextResponse.json(
      {
        error: `El límite de Instagram para ${limits.label} es ${Math.round(limits.maxBytes / 1024 / 1024)} MB y este pesa ${(file.size / 1024 / 1024).toFixed(1)} MB.`,
      },
      { status: 422 },
    );
  }

  try {
    // Nombre aleatorio: dos archivos con el mismo nombre no deben pisarse, y la
    // URL no debe revelar nada del contenido.
    const blob = await put(`media/${newId('m')}.${extension}`, file, {
      access: 'public',
      contentType: file.type || undefined,
    });

    return NextResponse.json({
      url: blob.url,
      type,
      sizeBytes: file.size,
      fileName: file.name,
    });
  } catch (error) {
    console.error('[uploads]', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
