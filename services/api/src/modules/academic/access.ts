import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { HttpError } from "../../shared/http/http-error.js";
import { validateId } from "../workspaces/service.js";

export type UnitRole = "unit_admin" | "unit_head";

export interface Actor {
  userId: string;
  systemAdmin: boolean;
  unitRoles: Map<string, Set<UnitRole>>;
  staff: { unitId: string; rank: string; active: boolean } | null;
}

export const forbidden = (message = "Bạn không có quyền thực hiện thao tác này.") =>
  new HttpError(403, "FORBIDDEN", message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
export const invalid = (message: string, code = "INVALID_INPUT") => new HttpError(400, code, message);
export const notFound = (message: string) => new HttpError(404, "NOT_FOUND", message);

export async function loadActor(client: PoolClient, userId: string): Promise<Actor> {
  const grants = await client.query<{ role: string; unit_id: string | null }>(
    `SELECT role,unit_id FROM academic_role_grants WHERE user_id=$1`,
    [userId],
  );
  const staff = await client.query<{ unit_id: string; academic_rank: string; active: boolean }>(
    `SELECT unit_id,academic_rank,active FROM academic_staff WHERE user_id=$1`,
    [userId],
  );
  const unitRoles = new Map<string, Set<UnitRole>>();
  for (const grant of grants.rows)
    if (grant.unit_id)
      (unitRoles.get(grant.unit_id) ?? unitRoles.set(grant.unit_id, new Set()).get(grant.unit_id)!).add(
        grant.role as UnitRole,
      );
  return {
    userId,
    systemAdmin: grants.rows.some((grant) => grant.role === "system_admin"),
    unitRoles,
    staff: staff.rows[0]
      ? { unitId: staff.rows[0].unit_id, rank: staff.rows[0].academic_rank, active: staff.rows[0].active }
      : null,
  };
}

export function hasUnitRole(actor: Actor, unitId: string, ...roles: UnitRole[]): boolean {
  return actor.systemAdmin || roles.some((role) => actor.unitRoles.get(unitId)?.has(role));
}

export function requireUnitRole(actor: Actor, unitId: string, ...roles: UnitRole[]): void {
  if (!hasUnitRole(actor, unitId, ...roles))
    throw forbidden("Thao tác này dành cho giáo vụ khoa.");
}

export async function audit(
  client: PoolClient,
  entry: {
    unitId?: string | null;
    termId?: string | null;
    actorId: string | null;
    entity: string;
    entityId: string;
    action: string;
    details?: object;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO academic_audit_events(id,unit_id,term_id,actor_id,entity,entity_id,action,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [
      randomUUID(),
      entry.unitId ?? null,
      entry.termId ?? null,
      entry.actorId,
      entry.entity,
      entry.entityId,
      entry.action,
      JSON.stringify(entry.details ?? {}),
    ],
  );
}

// ---- input readers -------------------------------------------------------

export function text(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max)
    throw invalid(`${label} phải có từ ${min} đến ${max} ký tự.`);
  return value.trim();
}

export function integer(value: unknown, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max)
    throw invalid(`${label} phải là số nguyên từ ${min} đến ${max}.`);
  return Number(value);
}

export function choice<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== "string" || !values.includes(value as T))
    throw invalid(`${label} phải là một trong: ${values.join(", ")}.`);
  return value as T;
}

export function code(value: unknown, label: string, max = 20): string {
  if (typeof value !== "string" || !new RegExp(`^[A-Z0-9_.-]{2,${max}}$`).test(value.trim().toUpperCase()))
    throw invalid(`${label} chỉ gồm chữ in hoa, số, '_', '-', '.' (2–${max} ký tự).`);
  return value.trim().toUpperCase();
}

export function id(value: unknown): string {
  validateId(value);
  return value;
}
