import { describe, expect, it } from "vitest";

import {
  encodeSseEvent,
  readConvertStream,
  type ConvertDoneEvent,
} from "@/lib/floorplan/convert-stream";

function responseFromChunks(text: string, chunkSize: number): Response {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
  return new Response(stream);
}

const done: ConvertDoneEvent = {
  type: "done",
  engine: "ai",
  savedImageId: 42,
  savedImagePath: "generated/x.png",
  savedImageUrl: "/api/image?id=42&variant=full&v=abc",
  sourceImageId: 7,
  compareBefore: "data:image/jpeg;base64,AAAA",
  result: "",
  layout: {
    canvasWidth: 1141, canvasHeight: 815, imageX: 161, imageY: 80, imageWidth: 1, imageHeight: 1,
    cropLeft: 0, cropTop: 0, cropWidth: 1, cropHeight: 1, preparedWidth: 1, preparedHeight: 1,
    outerFrameInset: 30, outerFrameStroke: 3,
  },
};

const payload =
  encodeSseEvent({ type: "status", message: "Förbereder uppladdad bild", engine: "ai" }) +
  encodeSseEvent(done);

describe("readConvertStream", () => {
  // 1 and 7 split events mid-JSON and mid-multibyte character; 100000 delivers all at once.
  it.each([1, 7, 64, 100000])("parses with chunk size %i", async (chunkSize) => {
    const statuses: string[] = [];
    const result = await readConvertStream(responseFromChunks(payload, chunkSize), {
      onStatus: (event) => statuses.push(event.message),
    });
    expect(statuses).toEqual(["Förbereder uppladdad bild"]);
    expect(result).toEqual(done);
  });

  it("rejects with the server's message on an error event", async () => {
    const stream = responseFromChunks(
      encodeSseEvent({ type: "error", message: "Kunde inte bearbeta bilden." }),
      5,
    );
    await expect(readConvertStream(stream)).rejects.toThrow("Kunde inte bearbeta bilden.");
  });

  it("does not resolve silently when the stream ends without a done event", async () => {
    const stream = responseFromChunks(encodeSseEvent({ type: "status", message: "hej" }), 5);
    await expect(readConvertStream(stream)).rejects.toThrow(/avbröts/);
  });
});
