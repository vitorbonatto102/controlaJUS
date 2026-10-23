import { formatCpf, isValidCpf } from "./validation";

export type ExtractedContractor = { fullName: string | null; cpf: string | null };

export function extractContractors(text: string): ExtractedContractor[] {
  const tagged = /\bCONTRATANTES?\s*:\s*/i.exec(text);
  const introduction = /\bde\s+u(?:m|rn)\s+lado\s*,?\s*/i.exec(text);
  const start = tagged ?? introduction;
  if (!start) return [];
  const region = text.slice(start.index + start[0].length).split(/\bdoravante\b|\bCONTRATAD[AO]S?\s*:|\be\s*,?\s*de\s+outro\s+lado\b|\bCL[ÁA]USULA\b/i)[0].slice(0, 6000);
  const names = [...region.matchAll(/([\p{L}][\p{L}\s'’§.\-]{1,159}?)\s*,\s*(?:brasileir[oa]s?|portugu[eê]s[ae]?|argentin[oa]|uruguai[oa])/giu)];
  // Older templates name the contractor explicitly, even without nationality.
  if (!names.length && tagged) {
    const name = /^([^,]{2,160})\s*,/.exec(region);
    if (name) names.push(Object.assign([name[0], name[1]], { index: 0, input: region }) as RegExpExecArray);
  }
  return names.map((name, index) => {
    const identity = region.slice(name.index! + name[0].length, names[index + 1]?.index ?? region.length);
    const cpf = /\bCPF(?:\s*\/\s*MF)?\s*(?:sob\s*o?\s*)?(?:(?:n(?:[.\s]*[º°o])?\.?|n[uú]mero)\s*)?[".:º°\s–-]*([\dOoIiLlAa]{3}\s*\.?\s*[\dOoIiLlAa]{3}\s*\.?\s*[\dOoIiLlAa]{3}\s*[.-]?\s*[\dOoIiLlAa]{2})(?![\dOoIiLlAa])/i.exec(identity)?.[1] ?? null;
    // OCR characters in a CPF are never silently guessed or replaced.
    return { fullName: name[1].trim().replace(/^e\s+/i, "").replace(/\s+/g, " "),
      cpf: cpf && !/[a-z]/i.test(cpf) && isValidCpf(cpf) ? formatCpf(cpf) : null };
  });
}
