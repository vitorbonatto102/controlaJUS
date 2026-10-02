import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth/profile";

export default async function AdminUsersPage() {
  await requireRole("admin");
  redirect("/administracao");
}
