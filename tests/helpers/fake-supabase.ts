/**
 * Just enough of the Supabase client for the convert routes: the query-builder chains they
 * use, and a storage bucket held in memory. Every call is recorded so a test can assert on
 * what was written without a database.
 */

type Row = Record<string, unknown>;

export type FakeSupabaseOptions = {
  /** Rows already in uploaded_images, keyed by id. */
  rows?: Row[];
  /** Objects already in storage, keyed by path. */
  objects?: Record<string, Buffer>;
  /** Column names the table does not have, to imitate a migration that has not run yet. */
  missingColumns?: string[];
};

export type FakeSupabase = ReturnType<typeof createFakeSupabase>;

export function createFakeSupabase({ rows = [], objects = {}, missingColumns = [] }: FakeSupabaseOptions = {}) {
  const table = new Map<number, Row>(rows.map((row) => [Number(row.id), { ...row }]));
  const storage = new Map<string, Buffer>(Object.entries(objects));
  const calls: { op: string; table?: string; payload?: unknown }[] = [];
  let nextId = Math.max(100, ...table.keys()) + 1;

  function missingColumnError(payload: Row) {
    const missing = Object.keys(payload).find((key) => missingColumns.includes(key));
    return missing
      ? { code: "PGRST204", message: `Could not find the '${missing}' column of 'uploaded_images'` }
      : null;
  }

  function from(tableName: string) {
    let filterId: number | null = null;
    let pending: { kind: "select" } | { kind: "insert"; row: Row } | { kind: "update"; patch: Row } = {
      kind: "select",
    };

    const resolveSingle = () => {
      if (pending.kind === "insert") {
        const error = missingColumnError(pending.row);
        if (error) return { data: null, error };
        const id = nextId++;
        const row = { id, ...pending.row };
        table.set(id, row);
        return { data: row, error: null };
      }
      const row = filterId === null ? undefined : table.get(filterId);
      return row ? { data: row, error: null } : { data: null, error: { message: "not found" } };
    };

    const builder = {
      select() {
        return builder;
      },
      insert(row: Row) {
        calls.push({ op: "insert", table: tableName, payload: row });
        pending = { kind: "insert", row };
        return builder;
      },
      update(patch: Row) {
        calls.push({ op: "update", table: tableName, payload: patch });
        pending = { kind: "update", patch };
        return builder;
      },
      eq(_column: string, value: unknown) {
        filterId = Number(value);
        if (pending.kind === "update") {
          const error = missingColumnError(pending.patch);
          const row = table.get(filterId);
          if (!error && row) Object.assign(row, pending.patch);
          return Promise.resolve({ data: null, error });
        }
        return builder;
      },
      single: async () => resolveSingle(),
      maybeSingle: async () => {
        const result = resolveSingle();
        return result.data ? result : { data: null, error: null };
      },
    };
    return builder;
  }

  const bucket = {
    async upload(path: string, body: Buffer | Uint8Array) {
      calls.push({ op: "upload", payload: path });
      storage.set(path, Buffer.from(body));
      return { data: { path }, error: null };
    },
    async remove(paths: string[]) {
      calls.push({ op: "remove", payload: paths });
      paths.forEach((path) => storage.delete(path));
      return { data: null, error: null };
    },
    async list(_folder: string, { search }: { search?: string } = {}) {
      return {
        data: search ? [{ name: search, metadata: { eTag: '"etag-1"' } }] : [],
        error: null,
      };
    },
    async download(path: string) {
      const buffer = storage.get(path);
      return buffer
        ? { data: new Blob([new Uint8Array(buffer)]), error: null }
        : { data: null, error: { message: "Object not found" } };
    },
  };

  return {
    client: { from, storage: { from: () => bucket } },
    table,
    storage,
    calls,
  };
}
