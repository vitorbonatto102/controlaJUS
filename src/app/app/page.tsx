import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { homeByRole } from "@/lib/auth/roles";

export default async function RoleHome() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!profile.active) redirect("/acesso-pendente");
  redirect(homeByRole[profile.role]);
}
