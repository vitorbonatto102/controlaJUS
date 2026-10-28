export const OFFICE_LOGO_BUCKET = "office-logos";
export const OFFICE_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const OFFICE_LOGO_ACCEPT = "image/png,image/jpeg,image/webp";

export function officeInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => Array.from(word)[0]).join("").toLocaleUpperCase("pt-BR") || "ES";
}

// Alias preservado para os fluxos e testes da identidade do escritório.
export { imageFormat as officeLogoFormat } from "@/lib/uploads/image-format";
