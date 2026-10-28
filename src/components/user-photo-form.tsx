"use client";

import { useActionState, useEffect, useRef, useState, type ChangeEvent } from "react";
import { emptyActionState, type ActionState } from "@/lib/action-state";
import { USER_AVATAR_ACCEPT, USER_AVATAR_MAX_BYTES } from "@/lib/users/avatar";
import { UserAvatar } from "./user-avatar";
import styles from "./user-avatar.module.css";

export function UserPhotoForm({ userId, name, avatarPath, avatarUrl, action, className }: {
  userId: string; name: string; avatarPath: string | null; avatarUrl: string | null;
  className?: string;
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
}) {
  const [state, save, pending] = useActionState(action, emptyActionState);
  const [preview, setPreview] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const objectUrl = useRef<string | null>(null);
  useEffect(() => () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); }, []);
  function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = null; setPreview(null); setLocalError(null);
    if (!file) return;
    if (!file.size || file.size > USER_AVATAR_MAX_BYTES || !USER_AVATAR_ACCEPT.split(",").includes(file.type)) {
      event.target.value = ""; setLocalError("Escolha uma imagem PNG, JPG ou WebP de até 2 MB."); return;
    }
    objectUrl.current = URL.createObjectURL(file); setPreview(objectUrl.current);
  }
  return <form action={save} className={`${styles.photoForm} ${className ?? ""}`}>
    <h3>Foto do usuário</h3>
    <input type="hidden" name="expected_path" value={avatarPath ?? ""} />
    <div className={styles.preview}><UserAvatar name={name} src={preview ?? avatarUrl} size={64} />
      <p>{preview ? "Prévia da nova foto. Salve para aplicar." : "A foto identifica esta pessoa no sistema. Sem foto, usamos as iniciais."}</p></div>
    <label htmlFor={`photo-${userId}`}>Escolher foto<input id={`photo-${userId}`} name="photo" type="file" accept={USER_AVATAR_ACCEPT}
      disabled={pending} onChange={selectPhoto} aria-describedby={`photo-help-${userId}`} /></label>
    <p id={`photo-help-${userId}`}>PNG, JPG ou WebP, até 2 MB. Prefira uma foto quadrada.</p>
    <div className={styles.actions}>
      <button type="submit" name="intent" value="upload" className="primary-button" disabled={pending || !preview}>
        {pending ? "Salvando…" : "Salvar foto"}</button>
      {avatarPath && <button type="submit" name="intent" value="remove" className="secondary-button" disabled={pending}>Remover foto</button>}
    </div>
    {(localError || state.error) && <p className="form-error-box" role="alert">{localError ?? state.error}</p>}
    {state.success && <p className="success-box" role="status">{state.success}</p>}
  </form>;
}
