import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

type JobStatus = "queued" | "processing" | "done" | "error";
type JobEventType = "log" | "done" | "error";
export type DownloadFormat = "png" | "jpg" | "jpeg" | "webp";

export type JobEvent = {
  type: JobEventType;
  data: string;
};

type FloorplanJob = {
  id: string;
  status: JobStatus;
  inputPath: string;
  outputPath: string;
  error: string | null;
  logs: string[];
  emitter: EventEmitter;
};

const FLOORPLAN_DIR = path.join(process.cwd(), "floorplanconvert");
const RESULTS_DIR = path.join(FLOORPLAN_DIR, "tmp_results");
const FONT_PATH = path.join(FLOORPLAN_DIR, "Montserrat-SemiBold.ttf");
const VENV_PYTHON = path.join(FLOORPLAN_DIR, ".venv", "bin", "python");
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
const FILE_TTL_MS = 2 * 60 * 60 * 1000;
const PYTHON_WARNING_FILTER = "ignore::DeprecationWarning";

const jobs = new Map<string, FloorplanJob>();
let cleanupStarted = false;

const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

const FORMAT_CONTENT_TYPE: Record<DownloadFormat, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

function parseBooleanEnv(name: string, fallback: boolean) {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  return ["1", "true", "yes", "on"].includes(raw);
}

function getPythonExecutable() {
  const configured = process.env.FLOORPLAN_PYTHON?.trim();
  if (configured) {
    return configured;
  }

  if (existsSync(VENV_PYTHON)) {
    return VENV_PYTHON;
  }

  return "python3";
}

function getConverterFlags() {
  const enableUpscale = parseBooleanEnv("FLOORPLAN_ENABLE_UPSCALE", false);
  const enableTextReplacement = parseBooleanEnv("FLOORPLAN_ENABLE_TEXT_REPLACEMENT", true);

  const flags: string[] = [];
  if (!enableUpscale) {
    flags.push("--no_upscale");
  }
  if (enableTextReplacement) {
    flags.push("--replace_text", "--font_path", FONT_PATH);
  }

  return { flags, enableUpscale, enableTextReplacement };
}

function normalizeLineBreaks(chunk: string) {
  return chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function emitJobEvent(job: FloorplanJob, event: JobEvent) {
  if (event.type === "log" && event.data.trim()) {
    job.logs.push(event.data);
  }
  job.emitter.emit("event", event);
}

function startCleanupLoop() {
  if (cleanupStarted) {
    return;
  }
  cleanupStarted = true;

  setInterval(() => {
    void cleanupOldFiles();
  }, CLEANUP_INTERVAL_MS).unref();
}

async function cleanupOldFiles() {
  await mkdir(RESULTS_DIR, { recursive: true });
  const entries = await readdir(RESULTS_DIR);
  const now = Date.now();

  await Promise.all(
    entries.map(async (entry) => {
      const filePath = path.join(RESULTS_DIR, entry);
      try {
        const fileStat = await stat(filePath);
        if (now - fileStat.mtimeMs > FILE_TTL_MS) {
          await unlink(filePath);
        }
      } catch {
        // Best-effort cleanup.
      }
    }),
  );
}

function runJob(job: FloorplanJob) {
  job.status = "processing";
  emitJobEvent(job, {
    type: "log",
    data: "Starting conversion pipeline...",
  });
  const { flags, enableUpscale, enableTextReplacement } = getConverterFlags();
  if (!enableUpscale) {
    emitJobEvent(job, {
      type: "log",
      data: "[speed] Fast mode enabled: skipping RealESRGAN upscale.",
    });
  }
  if (!enableTextReplacement) {
    emitJobEvent(job, {
      type: "log",
      data: "[speed] Text replacement disabled by config.",
    });
  }

  const child = spawn(
    getPythonExecutable(),
    [
      "-u",
      "-W",
      PYTHON_WARNING_FILTER,
      "floorplan_converter.py",
      job.inputPath,
      "--output_path",
      job.outputPath,
      ...flags,
    ],
    {
      cwd: FLOORPLAN_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdoutBuffer = "";
  let stderrBuffer = "";

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuffer += normalizeLineBreaks(chunk.toString("utf8"));
    const parts = stdoutBuffer.split("\n");
    stdoutBuffer = parts.pop() ?? "";
    for (const line of parts) {
      if (line.trim()) {
        emitJobEvent(job, { type: "log", data: line });
      }
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderrBuffer += normalizeLineBreaks(chunk.toString("utf8"));
    const parts = stderrBuffer.split("\n");
    stderrBuffer = parts.pop() ?? "";
    for (const line of parts) {
      if (line.trim()) {
        emitJobEvent(job, { type: "log", data: line });
      }
    }
  });

  child.on("error", (error) => {
    job.status = "error";
    job.error = `Kunde inte starta lokal konvertering: ${error.message}`;
    emitJobEvent(job, { type: "error", data: job.error });
  });

  child.on("close", (code) => {
    if (stdoutBuffer.trim()) {
      emitJobEvent(job, { type: "log", data: stdoutBuffer.trim() });
    }
    if (stderrBuffer.trim()) {
      emitJobEvent(job, { type: "log", data: stderrBuffer.trim() });
    }

    if (code === 0) {
      job.status = "done";
      emitJobEvent(job, { type: "done", data: job.id });
      return;
    }

    job.status = "error";
    job.error = "Lokal konvertering misslyckades.";
    emitJobEvent(job, { type: "error", data: job.error });
  });
}

export async function createFloorplanJob(file: File) {
  startCleanupLoop();
  await mkdir(RESULTS_DIR, { recursive: true });

  const ext = path.extname(file.name).toLowerCase() || MIME_TO_EXTENSION[file.type];
  const safeExtension = ext || ".png";
  const jobId = randomUUID();
  const inputPath = path.join(RESULTS_DIR, `${jobId}_input${safeExtension}`);
  const outputPath = path.join(RESULTS_DIR, `${jobId}_output.png`);

  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(inputPath, bytes);

  const job: FloorplanJob = {
    id: jobId,
    status: "queued",
    inputPath,
    outputPath,
    error: null,
    logs: [],
    emitter: new EventEmitter(),
  };

  jobs.set(jobId, job);
  runJob(job);

  return { jobId };
}

export function getFloorplanJob(jobId: string) {
  return jobs.get(jobId);
}

export function onJobEvent(jobId: string, listener: (event: JobEvent) => void) {
  const job = jobs.get(jobId);
  if (!job) {
    return null;
  }

  for (const log of job.logs) {
    listener({ type: "log", data: log });
  }

  if (job.status === "done") {
    listener({ type: "done", data: job.id });
  } else if (job.status === "error") {
    listener({
      type: "error",
      data: job.error ?? "Lokal konvertering misslyckades.",
    });
  }

  const wrappedListener = (event: JobEvent) => listener(event);
  job.emitter.on("event", wrappedListener);

  return () => {
    job.emitter.off("event", wrappedListener);
  };
}

async function runPythonCommand(args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(getPythonExecutable(), ["-u", "-W", PYTHON_WARNING_FILTER, ...args], {
      cwd: FLOORPLAN_DIR,
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || "Python conversion failed"));
    });
  });
}

export async function getJobDownload(jobId: string, format: DownloadFormat) {
  const job = jobs.get(jobId);
  if (!job) {
    return null;
  }

  if (job.status !== "done") {
    return {
      error:
        job.status === "error"
          ? job.error ?? "Lokal konvertering misslyckades."
          : "Result not ready",
      status: job.status === "error" ? 500 : 404,
    } as const;
  }

  if (format === "png") {
    const pngBytes = await readFile(job.outputPath);
    return {
      bytes: pngBytes,
      contentType: FORMAT_CONTENT_TYPE[format],
      fileName: "floorplan_converted.png",
    } as const;
  }

  const normalizedFormat = format === "jpeg" ? "jpg" : format;
  const outputPath = path.join(RESULTS_DIR, `${job.id}_download_${randomUUID()}.${normalizedFormat}`);

  try {
    await runPythonCommand([
      "-c",
      [
        "import sys",
        "from PIL import Image",
        "input_path, output_path, fmt = sys.argv[1], sys.argv[2], sys.argv[3]",
        "img = Image.open(input_path)",
        "fmt = 'jpg' if fmt == 'jpeg' else fmt",
        "if fmt == 'jpg':",
        "    if img.mode in ('RGBA', 'LA', 'P'):",
        "        rgba = img.convert('RGBA')",
        "        bg = Image.new('RGB', rgba.size, (255, 255, 255))",
        "        bg.paste(rgba, mask=rgba.getchannel('A'))",
        "        img = bg",
        "    else:",
        "        img = img.convert('RGB')",
        "    img.save(output_path, 'JPEG', quality=95)",
        "elif fmt == 'webp':",
        "    img.save(output_path, 'WebP', quality=95)",
        "else:",
        "    img.save(output_path, 'PNG')",
      ].join("; "),
      job.outputPath,
      outputPath,
      format,
    ]);

    const convertedBytes = await readFile(outputPath);
    return {
      bytes: convertedBytes,
      contentType: FORMAT_CONTENT_TYPE[format],
      fileName: `floorplan_converted.${normalizedFormat}`,
    } as const;
  } finally {
    try {
      await unlink(outputPath);
    } catch {
      // Best effort cleanup.
    }
  }
}
