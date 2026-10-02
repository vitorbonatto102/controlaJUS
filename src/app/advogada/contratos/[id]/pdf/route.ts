import { NextResponse, type NextRequest } from "next/server";
import { getCurrentProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getCurrentProfile();
  if (!profile || !profile.active || profile.role !== "lawyer") {
    return new NextResponse("Acesso negado", { status: 403 });
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Não encontrado", { status: 404 });
  const supabase = await createClient();
  const { data: contract, error } = await supabase.from("contracts")
    .select("contract_file_path").eq("id", id).eq("lawyer_id", profile.id).maybeSingle();
  if (error || !contract?.contract_file_path) return new NextResponse("Não encontrado", { status: 404 });
  const { data, error: signError } = await supabase.storage.from("contract-pdfs")
    .createSignedUrl(contract.contract_file_path, 60);
  if (signError || !data?.signedUrl) return new NextResponse("PDF indisponível", { status: 503 });
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "private, no-store" } });
}
