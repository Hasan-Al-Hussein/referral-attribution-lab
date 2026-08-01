export const DEFAULT_OPERATION_TIMEOUT_MS = 10_000;

export class OperationTimeoutError extends Error {
  constructor(readonly operation: string, readonly timeoutMs: number) {
    super(`${operation} timed out after ${timeoutMs}ms.`);
    this.name = 'OperationTimeoutError';
  }
}

export function withTimeout<T>(
  operation: Promise<T>,
  operationName: string,
  timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return operation;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new OperationTimeoutError(operationName, timeoutMs)),
      timeoutMs,
    );
    void operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
