import "server-only";
import { createClient } from "@/lib/supabase/server";

export type Closing = {
  id: string; lawyer_id: string; reference_month: number; reference_year: number;
  office_amount_received: number; commission_amount: number; adjustment_amount: number;
  office_adjustment_amount: number; amount_already_transferred: number;
  amount_pending_transfer: number; amount_overpaid: number;
  status: "draft" | "closed" | "partial" | "paid";
  closed_at: string | null; paid_at: string | null;
};
export type ClosingItem = {
  id: string; closing_id: string; payment_id: string; commission_id: string;
  payment_date: string; client_name: string; origin: string;
  amount_received: number; commission_percentage: number;
  commission_amount: number;
};
export type ClosingAdjustment = {
  id: string; closing_id: string; source_payment_id: string | null;
  office_delta: number; commission_delta: number; reason: string;
  created_at: string;
};
export type Transfer = {
  id: string; closing_id: string; lawyer_id: string; amount: number;
  payment_date: string; notes: string | null; reversed_at: string | null;
  reversal_reason: string | null;
};
export type Notification = {
  id: string; user_id: string; type: string; title: string; message: string;
  related_record_id: string | null; read_at: string | null; created_at: string;
};
export type AuditEntry = {
  id: string; user_id: string; affected_lawyer_id: string | null; table_name: string;
  record_id: string; field_name: string; old_value: unknown; new_value: unknown;
  reason: string; created_at: string;
};

async function allPages<T>(fetchPage: (from: number, to: number) => PromiseLike<{
  data: T[] | null; error: { message: string } | null;
}>): Promise<T[]> {
  const result: T[] = [];
  const size = 200;
  for (let offset = 0; ; offset += size) {
    const { data, error } = await fetchPage(offset, offset + size - 1);
    if (error) throw new Error("Não foi possível carregar os dados financeiros.");
    result.push(...(data ?? []));
    if (!data || data.length < size) break;
  }
  return result;
}

export async function loadClosings(lawyerId?: string) {
  const supabase = await createClient();
  const closings = await allPages<Closing>((from, to) => {
    let query = supabase.from("monthly_closings").select(`id,lawyer_id,reference_month,reference_year,
      office_amount_received,commission_amount,adjustment_amount,office_adjustment_amount,
      amount_already_transferred,amount_pending_transfer,amount_overpaid,status,closed_at,paid_at`);
    if (lawyerId) query = query.eq("lawyer_id", lawyerId);
    return query.order("reference_year", { ascending: false })
      .order("reference_month", { ascending: false }).range(from, to) as unknown as Promise<{
        data: Closing[] | null; error: { message: string } | null;
      }>;
  });
  return closings.map((closing) => ({ ...closing,
    office_amount_received: Number(closing.office_amount_received),
    commission_amount: Number(closing.commission_amount),
    adjustment_amount: Number(closing.adjustment_amount),
    office_adjustment_amount: Number(closing.office_adjustment_amount),
    amount_already_transferred: Number(closing.amount_already_transferred),
    amount_pending_transfer: Number(closing.amount_pending_transfer),
    amount_overpaid: Number(closing.amount_overpaid),
  }));
}

export async function loadClosingDetails() {
  const supabase = await createClient();
  const [items, transfers, adjustments] = await Promise.all([
    allPages<ClosingItem>((from, to) => supabase.from("monthly_closing_items")
      .select("id,closing_id,payment_id,commission_id,payment_date,client_name,origin,amount_received,commission_percentage,commission_amount")
      .order("id").range(from, to) as unknown as Promise<{ data: ClosingItem[] | null; error: { message: string } | null }>),
    allPages<Transfer>((from, to) => supabase.from("commission_transfers")
      .select("id,closing_id,lawyer_id,amount,payment_date,notes,reversed_at,reversal_reason")
      .order("payment_date", { ascending: false }).order("id").range(from, to) as unknown as Promise<{
        data: Transfer[] | null; error: { message: string } | null;
      }>),
    allPages<ClosingAdjustment>((from, to) => supabase.from("closing_adjustments")
      .select("id,closing_id,source_payment_id,office_delta,commission_delta,reason,created_at")
      .order("created_at", { ascending: false }).order("id").range(from, to) as unknown as Promise<{
        data: ClosingAdjustment[] | null; error: { message: string } | null;
      }>),
  ]);
  return {
    items: items.map((item) => ({ ...item, amount_received: Number(item.amount_received),
      commission_percentage: Number(item.commission_percentage), commission_amount: Number(item.commission_amount) })),
    transfers: transfers.map((item) => ({ ...item, amount: Number(item.amount) })),
    adjustments: adjustments.map((item) => ({ ...item, office_delta: Number(item.office_delta),
      commission_delta: Number(item.commission_delta) })),
  };
}

export async function loadNotifications(userId: string) {
  const supabase = await createClient();
  return allPages<Notification>((from, to) => {
    return supabase.from("notifications")
      .select("id,user_id,type,title,message,related_record_id,read_at,created_at")
      .eq("user_id", userId).order("created_at", { ascending: false }).range(from, to) as unknown as Promise<{
        data: Notification[] | null; error: { message: string } | null;
      }>;
  });
}

export async function loadAuditEntries() {
  const supabase = await createClient();
  return allPages<AuditEntry>((from, to) => {
    return supabase.from("audit_logs")
      .select("id,user_id,affected_lawyer_id,table_name,record_id,field_name,old_value,new_value,reason,created_at")
      .order("created_at", { ascending: false }).range(from, to) as unknown as Promise<{
        data: AuditEntry[] | null; error: { message: string } | null;
      }>;
  });
}
