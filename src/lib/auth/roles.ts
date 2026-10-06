export const roles = ["lawyer", "secretary", "manager"] as const;
export type Role = (typeof roles)[number];

export const homeByRole: Record<Role, string> = {
  lawyer: "/advogada",
  secretary: "/secretaria",
  manager: "/gestor",
};

export const roleLabel: Record<Role, string> = {
  lawyer: "Advogada",
  secretary: "Secretaria",
  manager: "Gestor",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && roles.some((role) => role === value);
}
