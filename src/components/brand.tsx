import Image from "next/image";

export function RepassumLogo({ light = false }: { light?: boolean }) {
  return <Image className="repassum-logo" src={`/branding/repassum/repassum-logo${light ? "-branco" : ""}.svg`}
    alt="Repassum" width={455} height={104} priority />;
}

export function AuthIntro({ title, description }: { title: string; description: string }) {
  return <div className="login-intro">
    <RepassumLogo light />
    <div className="login-story"><p className="eyebrow">CONTROLE QUE ACOMPANHA CADA VALOR</p>
      <h1>{title}</h1><p>{description}</p>
      <div className="login-topics"><span>Contratos</span><span>Recebimentos</span><span>Repasses</span></div>
    </div>
    <p className="login-signature">Clareza para a rotina financeira do seu escritório.</p>
  </div>;
}
