import type { Request } from "express";

// Express 5 types a route param as string | string[] when middleware is
// chained before the handler. Route params here are always single values.
export function param(req: Request, name: string): string {
  const v = (req.params as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(v) ? v[0] : (v ?? "");
}
