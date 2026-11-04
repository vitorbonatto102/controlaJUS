import {ORIGINS} from "@/lib/contracts/validation";
import {ReportError} from "./model";

export function parseClosingOrigins(params: URLSearchParams): string[] {
  const values=params.getAll("origem").map(value=>value.trim()).filter(Boolean);
  if(values.some(value=>!ORIGINS.some(origin=>origin===value))) throw new ReportError("Selecione origens válidas para o relatório do fechamento.");
  return ORIGINS.filter(origin=>values.includes(origin));
}
export function closingOriginsQuery(origins: string[]): string {
  const params=new URLSearchParams();
  for(const origin of origins) params.append("origem",origin);
  return params.toString();
}
