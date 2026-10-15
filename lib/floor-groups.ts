/**
 * Floors of one house.
 *
 * Every floor of a multi-floor scan is its own generation and its own row, and nothing in the
 * database says they belong together. So the group travels in the stored file's name, which
 * needs no migration: `generated/<time>-<uuid>-g<run>-f<position>-n<total>.png`, where `run`
 * is shared by every floor drawn in one go, `position` is the floor's place in the scan
 * (0 = lowest) and `total` how many floors the scan has. Plain plans keep the plain name.
 */
export type FloorGroup = {
  run: string;
  position: number;
  total: number;
};

const RUN_PATTERN = /^[0-9a-f]{12}$/;
const NAME_PATTERN = /-g([0-9a-f]{12})-f(\d{1,3})-n(\d{1,3})\.[a-z0-9]+$/i;

export function newFloorRun(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function isValidGroup(group: FloorGroup) {
  return (
    RUN_PATTERN.test(group.run) &&
    Number.isInteger(group.position) &&
    Number.isInteger(group.total) &&
    group.total >= 2 &&
    group.total <= 100 &&
    group.position >= 0 &&
    group.position < group.total
  );
}

/** Reads a group from untrusted input; anything not exactly right means "not grouped". */
export function parseFloorGroupInput(value: unknown): FloorGroup | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const { run, position, total } = value as Record<string, unknown>;
  if (typeof run !== "string" || typeof position !== "number" || typeof total !== "number") {
    return null;
  }
  const group = { run, position, total };
  return isValidGroup(group) ? group : null;
}

/** What goes between the generated file's name and its extension. */
export function floorGroupSuffix(group: FloorGroup | null | undefined): string {
  return group && isValidGroup(group) ? `-g${group.run}-f${group.position}-n${group.total}` : "";
}

/** The group a stored file belongs to, from its path or name. */
export function parseFloorGroup(filePath: string | null | undefined): FloorGroup | null {
  const match = filePath ? NAME_PATTERN.exec(filePath) : null;
  if (!match) {
    return null;
  }
  const group = { run: match[1], position: Number(match[2]), total: Number(match[3]) };
  return isValidGroup(group) ? group : null;
}

/** "Våning 1 (nedersta)" … by position, since the scan does not say what a floor is. */
export function floorLabel(position: number, total: number) {
  const suffix = position === 0 ? " (nedersta)" : position === total - 1 ? " (översta)" : "";
  return `Våning ${position + 1}${suffix}`;
}

export type GroupableItem = { id: number; file_path: string };

export type LibraryEntry<T extends GroupableItem> =
  | { kind: "single"; item: T }
  | {
      kind: "group";
      run: string;
      /** The floors found, lowest first. */
      floors: { item: T; position: number; total: number }[];
    };

/**
 * Folds the floors of one run into a single entry, placed where the first of them stood (the
 * list is newest first, so a house sits where its newest floor is). A run with only one floor
 * present stays a plain card.
 */
export function groupLibraryItems<T extends GroupableItem>(items: T[]): LibraryEntry<T>[] {
  const byRun = new Map<string, { item: T; position: number; total: number }[]>();
  for (const item of items) {
    const group = parseFloorGroup(item.file_path);
    if (group) {
      byRun.set(group.run, [...(byRun.get(group.run) ?? []), { item, ...group }]);
    }
  }

  const entries: LibraryEntry<T>[] = [];
  const placed = new Set<string>();
  for (const item of items) {
    const group = parseFloorGroup(item.file_path);
    const members = group ? byRun.get(group.run) : undefined;
    if (!group || !members || members.length < 2) {
      entries.push({ kind: "single", item });
      continue;
    }
    if (placed.has(group.run)) {
      continue;
    }
    placed.add(group.run);
    entries.push({
      kind: "group",
      run: group.run,
      floors: [...members].sort((a, b) => a.position - b.position || b.item.id - a.item.id),
    });
  }
  return entries;
}
