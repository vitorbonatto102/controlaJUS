"use client";

import Image from "next/image";
import { useState } from "react";
import { userInitials } from "@/lib/users/avatar";
import styles from "./user-avatar.module.css";

export function UserAvatar({ name, src, size = 40 }: { name: string; src?: string | null; size?: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  return <span className={styles.avatar} style={{ width: size, height: size, fontSize: Math.round(size * .32) }} aria-hidden="true">
    {src && failed !== src ? <Image src={src} alt="" width={size} height={size} unoptimized
      onError={() => setFailed(src)} /> : userInitials(name)}
  </span>;
}
