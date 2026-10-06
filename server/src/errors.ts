export class AppError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 500
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorDetails(error: unknown): { message: string; code: string; status: number } {
  if (error instanceof AppError) {
    return { message: error.message, code: error.code, status: error.status };
  }
  if (error instanceof Error) {
    return { message: error.message, code: 'INTERNAL_ERROR', status: 500 };
  }
  return { message: 'An unexpected error occurred.', code: 'INTERNAL_ERROR', status: 500 };
}
