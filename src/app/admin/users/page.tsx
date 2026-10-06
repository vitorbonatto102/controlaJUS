import { redirect } from "next/navigation";
import { requireOfficeAdmin } from "@/lib/auth/profile";

export default async function AdminUsersPage() {
  await requireOfficeAdmin();
  redirect("/administracao");
}
