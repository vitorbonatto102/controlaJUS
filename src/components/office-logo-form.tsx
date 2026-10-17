"use client";

import { useActionState } from "react";
import { updateOfficeLogo } from "@/app/administracao/branding-actions";
import { emptyActionState } from "@/lib/action-state";
import { OFFICE_LOGO_ACCEPT } from "@/lib/offices/branding";

export function OfficeLogoForm({ hasLogo }: { hasLogo: boolean }) {
  const [state, action, pending] = useActionState(updateOfficeLogo, emptyActionState);
  return <form action={action} className="office-logo-form">
    <label>Logo do escritório<input type="file" name="logo" accept={OFFICE_LOGO_ACCEPT}
      aria-describedby="logo-help" disabled={pending} /></label>
    <small id="logo-help">PNG, JPG ou WebP, até 2 MB. Prefira uma imagem quadrada com margem ao redor da marca.</small>
    <div className="office-logo-actions">
      <button type="submit" name="intent" value="upload" className="primary-button" disabled={pending}>
        {pending ? "Salvando…" : "Salvar logo"}</button>
      {hasLogo && <button type="submit" name="intent" value="remove" className="secondary-button" disabled={pending}>Remover logo</button>}
    </div>
    {state.error && <p className="form-error-box" role="alert">{state.error}</p>}
    {state.success && <p className="success-box" role="status">{state.success}</p>}
  </form>;
}
