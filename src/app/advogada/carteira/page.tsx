import type { Metadata } from "next";
import { DashboardShell } from "@/components/dashboard-shell";
import { LawyerWallet } from "@/components/wallet/lawyer-wallet";
import { WalletSettlements } from "@/components/wallet/wallet-settlements";
import { requireRole } from "@/lib/auth/profile";
import { loadLawyerContracts } from "@/lib/contracts/data";
import { todayInSaoPaulo } from "@/lib/contracts/view";
import { loadClosings, loadLawyerTransfers } from "@/lib/finance/data";

export const metadata: Metadata = { title: "Carteira | Repassum" };

export default async function WalletPage() {
  const profile = await requireRole("lawyer");
  // Authenticated queries retain RLS and explicitly scope each dataset to this lawyer.
  const [contracts, closings, transfers] = await Promise.all([
    loadLawyerContracts(profile.id), loadClosings(profile.id), loadLawyerTransfers(profile.id),
  ]);
  return <DashboardShell profile={profile}>
    <LawyerWallet contracts={contracts} today={todayInSaoPaulo()} transfers={transfers.map((transfer) => ({
      id: transfer.id, amount: transfer.amount, payment_date: transfer.payment_date, reversed_at: transfer.reversed_at,
    }))}>
      <WalletSettlements closings={closings} transfers={transfers} />
    </LawyerWallet>
  </DashboardShell>;
}
