import { NextResponse } from "next/server";

type JsonResult<T> = { ok: true; data: T } | { ok: false; response: NextResponse };

/**
 * A request's JSON body, refused with 413 once it passes `maxBytes`. The body is counted as it
 * streams in, so an oversized request is never held in memory whole.
 */
export async function readJsonCapped<T>(request: Request, maxBytes: number): Promise<JsonResult<T>> {
  const tooLarge = () => ({
    ok: false as const,
    response: NextResponse.json({ message: "Förfrågan är för stor." }, { status: 413 }),
  });

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge();
  if (!request.body) {
    // No body is an empty object, like an empty one.
    return { ok: true, data: {} as T };
  }

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

  try {
    const text = new TextDecoder().decode(Buffer.concat(chunks));
    return { ok: true, data: (text.trim() ? JSON.parse(text) : {}) as T };
  } catch {
    return { ok: false, response: NextResponse.json({ message: "Ogiltig förfrågan." }, { status: 400 }) };
  }
}
