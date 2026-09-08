export const CONVERT_STREAM_CONTENT_TYPE = "text/event-stream";

export type ConvertEngine = "ai" | "algorithm";

export type ConvertLayout = {
  canvasWidth: number;
  canvasHeight: number;
  imageX: number;
  imageY: number;
  imageWidth: number;
  imageHeight: number;
  cropLeft: number;
  cropTop: number;
  cropWidth: number;
  cropHeight: number;
  preparedWidth: number;
  preparedHeight: number;
  outerFrameInset: number;
  outerFrameStroke: number;
};

export type ConvertStatusEvent = {
  type: "status";
  message: string;
  engine?: ConvertEngine;
};

export type ConvertDoneEvent = {
  type: "done";
  engine: ConvertEngine;
  savedImageId: number;
  savedImagePath: string;
  savedImageUrl: string | null;
  sourceImageId: number;
  compareBefore: string;
  result: string;
  layout: ConvertLayout;
};

export type ConvertErrorEvent = {
  type: "error";
  message: string;
};

export type ConvertStreamEvent = ConvertStatusEvent | ConvertDoneEvent | ConvertErrorEvent;

export type ConvertStreamHandlers = {
  onStatus?: (event: ConvertStatusEvent) => void;
};

export function encodeSseEvent(event: ConvertStreamEvent) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function parseEventChunk(chunk: string): ConvertStreamEvent | null {
  const payload = chunk
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("");

  if (!payload) {
    return null;
  }

  try {
    return JSON.parse(payload) as ConvertStreamEvent;
  } catch {
    return null;
  }
}

/**
 * Reads the convert route's event stream, forwarding progress to the caller and resolving
 * with the final result.
 */
export async function readConvertStream(
  response: Response,
  handlers: ConvertStreamHandlers = {},
): Promise<ConvertDoneEvent> {
  const body = response.body;
  if (!body) {
    throw new Error("Kunde inte läsa svaret från servern.");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done: ConvertDoneEvent | null = null;
  let failure: string | null = null;

  const handleEvent = (event: ConvertStreamEvent) => {
    switch (event.type) {
      case "status":
        handlers.onStatus?.(event);
        break;
      case "done":
        done = event;
        break;
      case "error":
        failure = event.message;
        break;
    }
  };

  try {
    for (;;) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let separatorIndex = buffer.indexOf("\n\n");
      while (separatorIndex !== -1) {
        const chunk = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);

        const event = parseEventChunk(chunk);
        if (event) {
          handleEvent(event);
        }

        separatorIndex = buffer.indexOf("\n\n");
      }
    }

    const trailing = parseEventChunk(buffer);
    if (trailing) {
      handleEvent(trailing);
    }
  } finally {
    reader.releaseLock();
  }

  if (failure) {
    throw new Error(failure);
  }

  if (!done) {
    throw new Error("Konverteringen avbröts innan bilden blev klar.");
  }

  return done;
}
