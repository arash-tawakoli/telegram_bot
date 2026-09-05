export function checked<T>(
  result: { data: T; error: { message: string } | null },
  operation: string,
): T {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`);
  return result.data;
}
