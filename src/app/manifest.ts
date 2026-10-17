import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Repassum · Gestão financeira jurídica", short_name: "Repassum",
    description: "Controle que acompanha cada valor.", lang: "pt-BR", start_url: "/app",
    display: "standalone", background_color: "#F5F7F3", theme_color: "#123439",
    icons: [192, 512].map((size) => ({ src: `/branding/repassum/android-chrome-${size}x${size}.png`,
      sizes: `${size}x${size}`, type: "image/png" })),
  };
}
