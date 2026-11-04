import {reportProfile,pdfResponse,reportErrorResponse} from "@/lib/reports/http";
import {loadPayoutReport} from "@/lib/finance/payout-report-data";
import {payoutReportDocument} from "@/lib/finance/payout-report-model";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=300;
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
  try{const profile=await reportProfile(),{id}=await params,record=await loadPayoutReport(profile,id);
    return await pdfResponse(payoutReportDocument(record),`repassum-repasse-${id.slice(0,8)}.pdf`);
  }catch(error){return reportErrorResponse(error);}
}
