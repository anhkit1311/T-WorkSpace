import { HttpError } from "../../../shared/http/http-error.js";
import { validateId } from "../../workspaces/service.js";

export type Body = Record<string, unknown>;

export const invalid = (message: string) => new HttpError(400, "INVALID_INPUT", message);
export const forbidden = () => new HttpError(403, "FORBIDDEN", "Bạn không có quyền thực hiện thao tác này.");
export const notFound = (message: string) => new HttpError(404, "NOT_FOUND", message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);

export function text(body: Body, key: string, max: number, options: { optional?: boolean; pattern?: RegExp } = {}) {
  const value = body[key];
  if ((value === undefined || value === null || value === "") && options.optional) return "";
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw invalid(`Trường "${key}" không hợp lệ.`);
  if (options.pattern && !options.pattern.test(value.trim())) throw invalid(`Trường "${key}" sai định dạng.`);
  return value.trim();
}

export function integer(body: Body, key: string, min: number, max: number, fallback?: number) {
  const value = body[key] ?? fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    throw invalid(`Trường "${key}" phải là số nguyên từ ${min} đến ${max}.`);
  return value;
}

export function oneOf<T extends string>(body: Body, key: string, values: readonly T[], fallback?: T): T {
  const value = body[key] ?? fallback;
  if (!values.includes(value as T)) throw invalid(`Trường "${key}" phải là một trong: ${values.join(", ")}.`);
  return value as T;
}

export function id(value: unknown): string {
  validateId(value);
  return value;
}

export function optionalId(value: unknown): string | null {
  return value === null || value === undefined || value === "" ? null : id(value);
}

export function bool(body: Body, key: string, fallback: boolean) {
  const value = body[key] ?? fallback;
  if (typeof value !== "boolean") throw invalid(`Trường "${key}" phải là true/false.`);
  return value;
}
