import { z } from "zod";

// Shared ?page=&limit= parsing so every list endpoint behaves the same.
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const toSkipTake = ({ page, limit }: { page: number; limit: number }) => ({
  skip: (page - 1) * limit,
  take: limit,
});

export function paginated<T>(items: T[], total: number, { page, limit }: { page: number; limit: number }) {
  return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
}
