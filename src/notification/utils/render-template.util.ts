export function renderTemplate(
  template: string | undefined,
  variables: Record<string, string>,
): string {
  if (!template) return '';
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : '',
  );
}
