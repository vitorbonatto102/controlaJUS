"use client";

import { useActionState, useState } from "react";
import { inviteUser, updateUser } from "@/app/administracao/actions";
import { emptyActionState } from "@/lib/action-state";
import { roleLabel, roles, type Role } from "@/lib/auth/roles";

export type AdminUser = { id: string; full_name: string; email: string; role: Role;
  active: boolean; is_office_admin: boolean; created_at: string };

function Feedback({ state }: { state: { error: string | null; success: string | null } }) {
  return <>{state.error && <p className="form-error-box" role="alert">{state.error}</p>}
    {state.success && <p className="success-box" role="status">{state.success}</p>}</>;
}

function UserEditor({ user }: { user: AdminUser }) {
  const updateThisUser = updateUser.bind(null, user.id);
  const [state, action, pending] = useActionState(updateThisUser, emptyActionState);
  return <details className="operation-details"><summary>Gerenciar</summary>
    <form action={action} className="operation-form">
      <label>Nome<input name="full_name" defaultValue={user.full_name} minLength={2} maxLength={160} required /></label>
      <label>Cargo<select name="role" defaultValue={user.role}>{roles.map((role) =>
        <option key={role} value={role}>{roleLabel[role]}</option>)}</select></label>
      <label className="check-line"><input type="checkbox" name="is_office_admin" defaultChecked={user.is_office_admin} />
        Admin do escritório: pode convidar e gerenciar usuários deste escritório</label>
      <label>Status<select name="active" defaultValue={String(user.active)}>
        <option value="true">Ativo</option><option value="false">Inativo</option></select></label>
      <label>Motivo da alteração<textarea name="reason" minLength={5} maxLength={1000} required /></label>
      <label className="check-line"><input type="checkbox" name="confirm" value="yes" required />
        Confirmo esta alteração</label>
      <button className="secondary-button" disabled={pending}>Salvar alteração</button>
      <Feedback state={state} />
    </form>
  </details>;
}

export function AdminUsers({ users }: { users: AdminUser[] }) {
  const [state, action, pending] = useActionState(inviteUser, emptyActionState);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [active, setActive] = useState("");
  const filtered = users.filter((user) =>
    (!search || `${user.full_name} ${user.email}`.toLocaleLowerCase("pt-BR")
      .includes(search.toLocaleLowerCase("pt-BR"))) &&
    (!role || user.role === role) && (!active || String(user.active) === active));
  return <>
    <section className="workspace-panel"><h2>Convidar usuário</h2>
      <p>A pessoa receberá um link para criar sua própria senha.</p>
      <form action={action} className="operation-form admin-invite-form">
        <label>Nome completo<input name="full_name" minLength={2} maxLength={160} required /></label>
        <label>E-mail<input name="email" type="email" maxLength={254} required /></label>
        <label>Cargo<select name="role">{roles.map((item) =>
          <option key={item} value={item}>{roleLabel[item]}</option>)}</select></label>
        <label className="check-line"><input type="checkbox" name="is_office_admin" />
          Também será admin do escritório</label>
        <button type="submit" className="primary-button" disabled={pending}>+ Convidar usuário</button>
        <Feedback state={state} />
      </form>
    </section>
    <section className="workspace-panel"><h2>Usuários</h2>
      <div className="manager-filters">
        <label>Nome ou e-mail<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar usuário" /></label>
        <label>Cargo<select value={role} onChange={(e) => setRole(e.target.value)}><option value="">Todos</option>
          {roles.map((item) => <option key={item} value={item}>{roleLabel[item]}</option>)}</select></label>
        <label>Status<select value={active} onChange={(e) => setActive(e.target.value)}>
          <option value="">Todos</option><option value="true">Ativos</option><option value="false">Inativos</option>
        </select></label>
      </div>
      {filtered.length ? <div className="table-scroll"><table className="data-table"><thead><tr>
        <th>Nome</th><th>E-mail</th><th>Cargo</th><th>Acesso administrativo</th><th>Status</th><th>Criado em</th><th>Ações</th>
      </tr></thead><tbody>{filtered.map((user) => <tr key={user.id}>
        <td>{user.full_name}</td><td>{user.email}</td><td>{roleLabel[user.role]}</td>
        <td>{user.is_office_admin ? "Admin do escritório" : "—"}</td>
        <td>{user.active ? "Ativo" : "Inativo"}</td>
        <td>{new Date(user.created_at).toLocaleDateString("pt-BR")}</td><td><UserEditor user={user} /></td>
      </tr>)}</tbody></table></div> : <p>Nenhum usuário encontrado.</p>}
    </section>
  </>;
}
