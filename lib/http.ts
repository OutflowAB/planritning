import { NextResponse } from "next/server";

type JsonResult<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

type BytesResult = { ok: true; data: Buffer } | { ok: false; response: NextResponse };

const tooLarge = () => ({
  ok: false as const,
  response: NextResponse.json({ message: "Förfrågan är för stor." }, { status: 413 }),
});

/**
 * A request's body, refused with 413 once it passes `maxBytes`. The body is counted as it
 * streams in, so an oversized request is never held in memory whole.
 */
export async function readBytesCapped(request: Request, maxBytes: number): Promise<BytesResult> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();
  if (!request.body) return { ok: true, data: Buffer.alloc(0) };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return tooLarge();
    }
    chunks.push(value);
  }
  return { ok: true, data: Buffer.concat(chunks) };
}

/** A request's JSON body, capped like readBytesCapped. No body is an empty object. */
export async function readJsonCapped<T>(request: Request, maxBytes: number): Promise<JsonResult<T>> {
  const read = await readBytesCapped(request, maxBytes);
  if (!read.ok) return read;
  try {
    const text = new TextDecoder().decode(read.data);
    return { ok: true, data: (text.trim() ? JSON.parse(text) : {}) as T };
  } catch {
    return { ok: false, response: NextResponse.json({ message: "Ogiltig förfrågan." }, { status: 400 }) };
  }
}
