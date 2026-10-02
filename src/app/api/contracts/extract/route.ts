import { getCurrentProfile } from "@/lib/auth/profile";
import { ContractExtractionError, extractContractData } from "@/lib/contracts/extraction";
import { MAX_PDF_BYTES } from "@/lib/contracts/validation";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const response = (message: string, status: number) =>
  Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return response("Origem não autorizada.", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return response("Formato de requisição inválido.", 415);
  }
  const profile = await getCurrentProfile();
  if (!profile || !profile.active || profile.role !== "lawyer") return response("Acesso não autorizado.", 403);

  let path: string;
  try {
    const body: unknown = await request.json();
    path = typeof body === "object" && body !== null && "path" in body &&
      typeof body.path === "string" ? body.path : "";
  } catch { return response("Informe o arquivo para leitura.", 400); }
  const parts = path.split("/");
  if (parts.length !== 4 || parts[0] !== "contracts" || parts[1] !== profile.id ||
      !uuid.test(parts[2]) || !uuid.test(parts[3].replace(/\.pdf$/i, "")) || !/\.pdf$/i.test(parts[3])) {
    return response("Arquivo não autorizado.", 403);
  }

  const supabase = await createClient();
  try {
    const { data: file, error } = await supabase.storage.from("contract-pdfs").download(path);
    if (error || !file) return response("Não foi possível acessar o PDF enviado.", 404);
    if (file.size > MAX_PDF_BYTES) return response("O PDF excede 10 MB.", 413);
    const data = await extractContractData(new Uint8Array(await file.arrayBuffer()));
    return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return response(error instanceof ContractExtractionError ? error.message :
      "Não foi possível analisar o contrato. Tente novamente.", 422);
  } finally {
    // O upload existe apenas para contornar o limite de requisição da Vercel.
    // A confirmação envia o arquivo de novo, então nenhuma análise o mantém salvo.
    await supabase.storage.from("contract-pdfs").remove([path]);
  }
}
