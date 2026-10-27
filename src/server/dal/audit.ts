import "server-only";
import { and, desc, eq, like, lt } from "drizzle-orm";
import { can, type Viewer } from "@/lib/permissions";
import type { DbOrTx } from "../db/client";
import { auditLog, users } from "../db/schema";

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

export const AUDIT_CATEGORIES = ["auth", "user", "lead", "import", "call", "note"] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export interface AuditRow {
  id: number;
  at: Date;
  actor: { id: string; name: string } | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
}

export interface AuditPage {
  rows: AuditRow[];
  /** Pass as `beforeId` for the next (older) page; null on the last page. */
  nextBeforeId: number | null;
}

/** Newest first, `limit` at a time. Admin only; null for anyone else. */
export async function listAudit(
  db: DbOrTx,
  viewer: Viewer,
  opts: { category?: AuditCategory; actorId?: string; entityId?: string; beforeId?: number; limit?: number } = {},
): Promise<AuditPage | null> {
  if (!can(viewer, "audit.view")) return null;
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const where = and(
    opts.category ? like(auditLog.action, `${opts.category}.%`) : undefined,
    opts.actorId ? eq(auditLog.actorId, opts.actorId) : undefined,
    opts.entityId ? eq(auditLog.entityId, opts.entityId) : undefined,
    opts.beforeId ? lt(auditLog.id, opts.beforeId) : undefined,
  );
  const result = await db
    .select({
      id: auditLog.id,
      at: auditLog.createdAt,
      actorId: users.id,
      actorName: users.name,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      before: auditLog.before,
      after: auditLog.after,
      ip: auditLog.ip,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .where(where)
    .orderBy(desc(auditLog.id))
    .limit(limit + 1);
  const page = result.slice(0, limit);
  return {
    rows: page.map(({ actorId, actorName, ...r }) => ({ ...r, actor: actorId && actorName !== null ? { id: actorId, name: actorName } : null })),
    nextBeforeId: result.length > limit ? page[page.length - 1].id : null,
  };
}
