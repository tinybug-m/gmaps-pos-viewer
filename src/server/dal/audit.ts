import "server-only";
import type { DbOrTx } from "../db/client";
import { auditLog } from "../db/schema";

/**
 * Security and admin events (sign-ins, user changes, imports, assignment,
 * voids). Write it in the same transaction as the change it describes.
 * Never put passwords, tokens or full lead records in `before`/`after`.
 */
export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: "user" | "lead" | "import" | "call" | "note" | "session";
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

export async function writeAudit(db: DbOrTx, entry: AuditEntry | AuditEntry[]): Promise<void> {
  const rows = Array.isArray(entry) ? entry : [entry];
  if (rows.length === 0) return;
  await db.insert(auditLog).values(
    rows.map((e) => ({
      actorId: e.actorId,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId ?? null,
      before: e.before ?? null,
      after: e.after ?? null,
      ip: e.ip ?? null,
    })),
  );
}
