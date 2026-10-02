export const ORIGINS = ["Cliente próprio", "Propriedade Intelectual", "Tráfego HP"] as const;
export const PERCENTAGES = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60] as const;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function isValidCpf(value: string): boolean {
  const cpf = onlyDigits(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const length of [9, 10]) {
    const sum = [...cpf.slice(0, length)].reduce(
      (total, digit, index) => total + Number(digit) * (length + 1 - index), 0,
    );
    const check = (sum * 10) % 11 % 10;
    if (check !== Number(cpf[length])) return false;
  }
  return true;
}

export function formatCpf(value: string): string {
  const digits = onlyDigits(value).slice(0, 11);
  return digits.replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1-$2");
}

export function isValidPdf(file: File): boolean {
  return file.size > 0 && file.size <= MAX_PDF_BYTES &&
    (file.type === "application/pdf" || file.type === "") && /\.pdf$/i.test(file.name);
}

export async function hasPdfSignature(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return bytes.length === 5 && bytes.every((byte, index) => byte === [37, 80, 68, 70, 45][index]);
}
