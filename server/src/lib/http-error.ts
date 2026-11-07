// Throw this from any route or service to send a clean error response.
// Example: throw new HttpError(404, "Lead not found")
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
