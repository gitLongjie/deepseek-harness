/**
 * Inline local media for the hosted MiniMax APIs: a local path becomes a base64 data URI, while an
 * http(s) URL or a `mm_file://{file_id}` id passes through as authored.
 * @module @deepseek-ai/dsh-h3-video/inline
 */

/**
 * Convert one reference source into the URL value the hosted API accepts. A local file beyond its
 * published per-modality cap fails before submission instead of sending a body the provider may
 * reject.
 * @param source - the reference source as authored.
 * @param mediaType - MIME family for the data URI (`image`, `video`, or `audio`).
 * @param capBytes - published inline cap for this media type.
 * @returns the API-ready URL value.
 */
export async function inlineMediaSource(
  source: string,
  mediaType: 'image' | 'video' | 'audio',
  capBytes: number,
): Promise<string> {
  if (/^(https?|mm_file):\/\//iu.test(source)) return source
  const { readFile } = await import('node:fs/promises')
  const { extname } = await import('node:path') as { extname: (path: string) => string }
  const bytes = await readFile(source)
  if (bytes.byteLength > capBytes) {
    throw new Error(
      `reference ${source} is ${Math.round(bytes.byteLength / 1024 / 1024)} MB, over the `
      + `${Math.round(capBytes / 1024 / 1024)} MB ${mediaType} cap; host it and pass an https URL instead`,
    )
  }
  // `image/jpg` is not a registered MIME type; JPEG files carry the `jpeg` subtype.
  const extension = extname(source).toLowerCase().replace('.', '') || 'bin'
  const subtype = extension === 'jpg' ? 'jpeg' : extension
  return `data:${mediaType}/${subtype};base64,${bytes.toString('base64')}`
}
