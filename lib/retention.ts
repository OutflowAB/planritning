/** Uploaded originals are kept this long; finished plans are kept until someone deletes them. */
export const ORIGINAL_RETENTION_DAYS = 90;

export function retentionCutoff(now = new Date()) {
  return new Date(now.getTime() - ORIGINAL_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/** Whether an uploaded original is old enough to be removed and has not been yet. */
export function isPurgeDue(row: { file_path: string; created_at: string; purged_at: string | null }, now = new Date()) {
  return row.file_path.startsWith("uploads/") && !row.purged_at && new Date(row.created_at) < retentionCutoff(now);
}
