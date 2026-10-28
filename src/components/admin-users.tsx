"use client";

import { Fragment, useActionState, useState } from "react";
import { inviteUser } from "@/app/administracao/actions";
import { emptyActionState } from "@/lib/action-state";
import { roleLabel, roles, type Role } from "@/lib/auth/roles";
import { UserAvatar } from "./user-avatar";
import { UserPhotoForm } from "./user-photo-form";
import photoStyles from "./user-avatar.module.css";
import styles from "./admin-users.module.css";

export type AdminUser = { id: string; full_name: string; email: string; role: Role;
  active: boolean; is_office_admin: boolean; created_at: string;
  avatarPath: string | null; avatarUrl: string | null;
  avatarAction: (state: typeof emptyActionState, form: FormData) => Promise<typeof emptyActionState>;
  updateAction: (state: typeof emptyActionState, form: FormData) => Promise<typeof emptyActionState> };

function Feedback({ state }: { state: { error: string | null; success: string | null } }) {
  return <>{state.error && <p className="form-error-box" role="alert">{state.error}</p>}
    {state.success && <p className="success-box" role="status">{state.success}</p>}</>;
}

function UserEditor({ user, photosReady }: { user: AdminUser; photosReady: boolean }) {
  const [state, action, pending] = useActionState(user.updateAction, emptyActionState);
  return <section id={`manage-${user.id}`} className={styles.editor} aria-label={`Gerenciar ${user.full_name}`}>
    <header className={styles.editorHeader}><strong>{user.full_name}</strong><span>{user.email}</span></header>
    <div className={`${styles.editorGrid} ${!photosReady ? styles.withoutPhoto : ""}`}>
    {photosReady && <UserPhotoForm key={user.avatarPath ?? "no-photo"} userId={user.id} name={user.full_name}
      avatarPath={user.avatarPath} avatarUrl={user.avatarUrl} action={user.avatarAction} className={styles.photoPanel} />}
    <form action={action} className={styles.profileForm}>
      <fieldset><legend>Dados do usuário</legend>
      <label>Nome<input name="full_name" defaultValue={user.full_name} minLength={2} maxLength={160} required /></label>
      <label>Cargo<select name="role" defaultValue={user.role}>{roles.map((role) =>
        <option key={role} value={role}>{roleLabel[role]}</option>)}</select></label>
      </fieldset>
      <fieldset><legend>Acesso ao sistema</legend>
      <label>Status<select name="active" defaultValue={String(user.active)}>
        <option value="true">Ativo</option><option value="false">Inativo</option></select></label>
      <label className={styles.checkLine}><input type="checkbox" name="is_office_admin" defaultChecked={user.is_office_admin} />
        <span>Admin do escritório<small>Pode convidar e gerenciar usuários deste escritório.</small></span></label>
      </fieldset>
      <label className={styles.note}>Motivo da alteração (opcional)<textarea name="reason" maxLength={1000} rows={2}
        placeholder="Se quiser, acrescente uma observação." /></label>
      <div className={styles.saveRow}><label className={styles.checkLine}><input type="checkbox" name="confirm" value="yes" required />
        Confirmo esta alteração</label>
      <button className="primary-button" disabled={pending}>{pending ? "Salvando…" : "Salvar alteração"}</button></div>
      <Feedback state={state} />
    </form>
    </div>
  </section>;
}

export function AdminUsers({ users, photosReady, photosError }: { users: AdminUser[]; photosReady: boolean; photosError: boolean }) {
  const [state, action, pending] = useActionState(inviteUser, emptyActionState);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [active, setActive] = useState("");
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
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
      {!photosReady ? <p className={photoStyles.notice}>As fotos de usuários aguardam a atualização do módulo no Supabase. Os demais controles continuam disponíveis.</p> :
        photosError ? <p className={photoStyles.notice} role="status">Algumas fotos não puderam ser carregadas. As iniciais identificam os usuários enquanto isso.</p> :
        <p>Para adicionar, trocar ou remover uma foto, abra <strong>Gerenciar</strong> na linha da pessoa.</p>}
      <div className="manager-filters">
        <label>Nome ou e-mail<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar usuário" /></label>
        <label>Cargo<select value={role} onChange={(e) => setRole(e.target.value)}><option value="">Todos</option>
          {roles.map((item) => <option key={item} value={item}>{roleLabel[item]}</option>)}</select></label>
        <label>Status<select value={active} onChange={(e) => setActive(e.target.value)}>
          <option value="">Todos</option><option value="true">Ativos</option><option value="false">Inativos</option>
        </select></label>
      </div>
      {filtered.length ? <div className="table-scroll"><table className={`data-table ${styles.usersTable}`}><thead><tr>
        <th>Nome</th><th>E-mail</th><th>Cargo</th><th>Acesso administrativo</th><th>Status</th><th>Criado em</th><th>Ações</th>
      </tr></thead><tbody>{filtered.map((user) => <Fragment key={user.id}><tr className={expandedUser === user.id ? styles.selectedRow : undefined}>
        <td data-label="Nome"><div className={photoStyles.userCell}><UserAvatar name={user.full_name} src={user.avatarUrl} /><span>{user.full_name}</span></div></td>
        <td data-label="E-mail">{user.email}</td><td data-label="Cargo">{roleLabel[user.role]}</td>
        <td data-label="Acesso administrativo">{user.is_office_admin ? "Admin do escritório" : "—"}</td>
        <td data-label="Status">{user.active ? "Ativo" : "Inativo"}</td>
        <td data-label="Criado em">{new Date(user.created_at).toLocaleDateString("pt-BR")}</td><td data-label="Ações">
          <button type="button" className={styles.toggle} aria-expanded={expandedUser === user.id}
            aria-controls={`manage-${user.id}`} aria-label={`Gerenciar ${user.full_name}`}
            onClick={() => setExpandedUser(expandedUser === user.id ? null : user.id)}>
            Gerenciar<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </button></td>
      </tr>{expandedUser === user.id && <tr className={styles.expandedRow}><td colSpan={7}>
        <UserEditor user={user} photosReady={photosReady} />
      </td></tr>}</Fragment>)}</tbody></table></div> : <p>Nenhum usuário encontrado.</p>}
    </section>
  </>;
}
