export const HttpStatus = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  INTERNAL: 500,
} as const;

export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = HttpStatus.INTERNAL,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends AppError {
  constructor(m = 'Not found') { super(m, HttpStatus.NOT_FOUND); }
}
export class ForbiddenError extends AppError {
  constructor(m = 'Forbidden') { super(m, HttpStatus.FORBIDDEN); }
}
export class ConflictError extends AppError {
  constructor(m = 'Conflict', d?: unknown) { super(m, HttpStatus.CONFLICT, d); }
}
export class BadRequestError extends AppError {
  constructor(m: string, d?: unknown) { super(m, HttpStatus.BAD_REQUEST, d); }
}
export class ValidationError extends AppError {
  constructor(m: string, d?: unknown) { super(m, HttpStatus.UNPROCESSABLE, d); }
}
export class UnauthorizedError extends AppError {
  constructor(m = 'Unauthorized') { super(m, HttpStatus.UNAUTHORIZED); }
}

/**
 * Last-resort translator for raw Postgres errors that reach the error handler.
 * Service-level checks should map most of these to domain errors first; this
 * backstop guarantees a well-formed 4xx — never a leaked `"Internal server error"`
 * carrying the raw DB string — for the known constraint/RAISE cases. Returns null
 * when the error is not a recognised DB error, so the handler falls through to a
 * generic 500. See Issue #3.
 *
 * drizzle-orm wraps the driver's real error in `DrizzleQueryError`, whose own
 * `message` is just "Failed query: ...params: ..." — the actual Postgres
 * `code`/`message` (what this function needs) live on `.cause`, one level
 * down. Checking only the top-level error meant every constraint/exclusion
 * violation quietly missed this backstop and fell through as an unhandled
 * 500 leaking the raw query/params to the client instead of a clean 4xx.
 */
export function translatePgError(error: unknown): AppError | null {
  const top = error as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = top?.code ?? top?.cause?.code;
  const message = `${top?.message ?? ''} ${top?.cause?.message ?? ''}`;

  if (/does not belong to org|has no active mapping to org|has been deleted/i.test(message)) {
    return new NotFoundError('The referenced record was not found or is not accessible');
  }

  switch (code) {
    case '23505': // unique_violation
    case '23P01': // exclusion_violation
      return new ConflictError('This record conflicts with an existing one');
    case '23503': // foreign_key_violation
    case '23514': // check_violation
      return new BadRequestError('The request references invalid or inconsistent data');
    default:
      return null;
  }
}
