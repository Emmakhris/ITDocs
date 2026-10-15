export class AppError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do that.") {
    super(message, 403);
  }
}
export class NotFoundError extends AppError {
  constructor(what = "Record") {
    super(`${what} not found.`, 404);
  }
}
export class FieldError extends AppError {
  constructor(public fieldErrors: Record<string, string>) {
    super("Please fix the highlighted fields.", 422);
  }
}
