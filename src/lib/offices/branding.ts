export const OFFICE_LOGO_BUCKET = "office-logos";
export const OFFICE_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const OFFICE_LOGO_ACCEPT = "image/png,image/jpeg,image/webp";

export function officeInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => Array.from(word)[0]).join("").toLocaleUpperCase("pt-BR") || "ES";
}

// Verifica a assinatura do arquivo, além do MIME informado pelo navegador.
export function officeLogoFormat(bytes: Uint8Array): { mime: string; extension: string } | null {
  if (bytes.length < 12) return null;
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value))
    return { mime: "image/png", extension: "png" };
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return { mime: "image/jpeg", extension: "jpg" };
  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP")
    return { mime: "image/webp", extension: "webp" };
  return null;
}
