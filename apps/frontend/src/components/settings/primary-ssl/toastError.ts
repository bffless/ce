export function errorMessage(error: unknown, fallback: string): string {
  const err = error as { data?: { message?: string } };
  return err?.data?.message || fallback;
}
