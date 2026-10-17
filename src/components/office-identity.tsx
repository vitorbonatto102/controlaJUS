import Image from "next/image";
import { officeInitials } from "@/lib/offices/branding";
import type { OfficeBrand } from "@/lib/offices/data";

export function OfficeIdentity({ office }: { office: OfficeBrand }) {
  return <div className="office-identity">
    <div className="office-mark">{office.logoUrl
      ? <Image src={office.logoUrl} alt="" width={64} height={64} unoptimized />
      : <span aria-hidden="true">{officeInitials(office.name)}</span>}</div>
    <div className="office-caption"><span>SEU ESCRITÓRIO</span><strong>{office.name}</strong></div>
  </div>;
}
