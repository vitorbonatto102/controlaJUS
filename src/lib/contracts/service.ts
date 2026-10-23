export const MAX_SERVICE_NAME_LENGTH = 240;

export function validateServiceName(value: string): string {
  const name = value.trim();
  if (name.length < 2 || name.length > MAX_SERVICE_NAME_LENGTH) {
    throw new Error(`Informe o serviço contratado ou nome da ação, entre 2 e ${MAX_SERVICE_NAME_LENGTH} caracteres.`);
  }
  return name;
}
