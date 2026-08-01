export type DemoResetResult =
  | { ok: true; committed: true }
  | { ok: false; committed: false; message: string }
  | { ok: false; committed: true; message: string };

export async function commitDemoReset(
  reset: () => Promise<void>,
  onCommitted: () => void,
): Promise<DemoResetResult> {
  try {
    await reset();
  } catch (error) {
    return {
      ok: false,
      committed: false,
      message:
        error instanceof Error
          ? error.message
          : 'Reset could not be committed. Please try again.',
    };
  }
  try {
    onCommitted();
    return { ok: true, committed: true };
  } catch (error) {
    return {
      ok: false,
      committed: true,
      message:
        error instanceof Error
          ? error.message
          : 'Reset committed, but the screen could not refresh.',
    };
  }
}
