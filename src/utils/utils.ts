export async function checkIsEmail(identifier: string): Promise<boolean> {
  return identifier.includes('@');
}
