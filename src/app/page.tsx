import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import localFont from "next/font/local";
import { RepassumLogo } from "@/components/brand";
import { formatBRL } from "@/lib/formatters";
import stillLife from "../../public/landing/repassum-still-life.webp";
import styles from "./landing.module.css";

const editorial = localFont({
  src: [
    { path: "./fonts/CormorantGaramond-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/CormorantGaramond-Italic.ttf", weight: "400", style: "italic" },
  ],
  variable: "--font-editorial", display: "swap", fallback: ["Georgia", "serif"], adjustFontFallback: "Times New Roman",
});

export const metadata: Metadata = {
  title: { absolute: "Repassum · Contratos também têm um fluxo" },
  description: "Do contrato ao repasse, com clareza em cada etapa. Conheça a Repassum, a plataforma para acompanhar o ciclo financeiro do seu escritório.",
  robots: { index: true, follow: true },
};

const resources = [
  { title: "Contratos", text: "Clientes, documentos e condições de cada contrato, organizados em um só lugar." },
  { title: "Recebimentos", text: "O valor previsto e o efetivamente recebido, acompanhados separadamente." },
  { title: "Inadimplência", text: "Parcelas vencidas e histórico de cobrança para dar continuidade a cada contato." },
  { title: "Comissões", text: "Participações vinculadas a cada advogada e aos valores recebidos pelo escritório." },
  { title: "Repasses", text: "Fechamentos e transferências com um histórico claro do que foi pago e do que falta repassar." },
];

const safeguards = [
  { title: "Um espaço para cada escritório", text: "Os dados ficam vinculados ao escritório. Cada equipe acessa o seu próprio ambiente." },
  { title: "Cada pessoa, o acesso adequado", text: "Advogadas, secretaria e gestão têm permissões próprias. Novos acessos acontecem por convite." },
  { title: "Um histórico para acompanhar", text: "Correções relevantes registram autoria e motivo, preservando o acompanhamento das alterações." },
];

const exampleMetrics = [
  { label: "A receber", value: 284500, bars: [9, 16, 24], tone: "green" },
  { label: "Recebido", value: 198320, bars: [24, 15, 11], tone: "green" },
  { label: "Inadimplência", value: 36200, bars: [7, 13, 23], tone: "red" },
  { label: "Repasses pendentes", value: 27100, bars: [7, 13, 18], tone: "red" },
] as const;

function FinancialIllustration() {
  return <figure className={styles.preview} aria-label="Exemplo de acompanhamento financeiro com valores fictícios">
    <dl>{exampleMetrics.map((metric) => <div key={metric.label} className={styles.previewRow}>
      <dt>{metric.label}</dt><dd><span>{formatBRL(metric.value)}</span>
      <svg width="26" height="28" viewBox="0 0 26 28" fill={metric.tone === "green" ? "#8ca98a" : "#bd7156"} aria-hidden="true">
        {metric.bars.map((height, index) => <rect key={index} x={index * 8} y={27 - height} width="6" height={height} opacity={0.6 + index * 0.2} />)}
      </svg></dd>
    </div>)}</dl>
    <figcaption>VALORES ILUSTRATIVOS</figcaption>
  </figure>;
}

export default function Home() {
  const email = process.env.REPASSUM_CONTACT_EMAIL?.trim();
  const contactHref = email && /^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(email) ? `mailto:${email}` : null;

  return <div className={`${styles.page} ${editorial.variable}`}>
    <a className={styles.skipLink} href="#conteudo">Ir para o conteúdo</a>
    <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Repassum, página inicial"><RepassumLogo light /></Link>
        <nav aria-label="Navegação da apresentação">
          <a href="#recursos">Recursos</a><a href="#seguranca">Segurança</a><a href="#contato">Contato</a>
          <Link href="/login" className={styles.access}>Acessar</Link>
        </nav>
    </header>
    <main id="conteudo">
    <section className={styles.hero} id="inicio" aria-labelledby="hero-title">
      <div className={styles.backdrop}>
        <Image src={stillLife} alt="" fill sizes="100vw" preload placeholder="blur" />
      </div>
      <div className={styles.shade} aria-hidden="true" />
      <div className={styles.heroContent}>
        <h1 className={styles.heroTitle} id="hero-title"><span>Contratos</span><span>também</span>
          <span>têm um <em>fluxo.</em></span></h1>
        <p className={styles.heroDescription}>Repassum é a plataforma interna para<br className={styles.desktopBreak} /> acompanhar o ciclo financeiro do escritório:<br className={styles.desktopBreak} /> do contrato ao repasse, com clareza em<br className={styles.desktopBreak} /> cada etapa.</p>
        <ul className={styles.heroTopics} aria-label="O ciclo financeiro na Repassum">
          {resources.map((resource) => <li key={resource.title}><a href="#recursos">{resource.title}</a></li>)}
        </ul>
      </div>
      <FinancialIllustration />
      <a href="#recursos" className={styles.discover}>Conheça o fluxo <span aria-hidden="true">↓</span></a>
    </section>
    <section className={`${styles.section} ${styles.resources}`} id="recursos" aria-labelledby="resources-title">
      <div className={styles.sectionIntro}><p className={styles.eyebrow}>UM CICLO. CADA ETAPA.</p>
        <h2 id="resources-title">Do primeiro contrato<br />ao último <em>repasse.</em></h2>
        <p>As informações se conectam para que o financeiro do escritório tenha continuidade, contexto e clareza.</p>
      </div>
      <div className={styles.resourceGrid}>{resources.map((resource, index) => <article key={resource.title}>
        <span className={styles.stepNumber}>0{index + 1}</span><h3>{resource.title}</h3><p>{resource.text}</p>
      </article>)}</div>
    </section>
    <section className={`${styles.section} ${styles.security}`} id="seguranca" aria-labelledby="security-title">
      <div><p className={styles.eyebrow}>CONFIANÇA EM CADA ETAPA</p>
        <h2 id="security-title">Informação na<br />medida de cada<br /><em>responsabilidade.</em></h2>
      </div>
      <div className={styles.safeguards}>{safeguards.map((item, index) => <article key={item.title}>
        <span className={styles.stepNumber}>0{index + 1}</span><div><h3>{item.title}</h3><p>{item.text}</p></div>
      </article>)}</div>
    </section>
    <section className={`${styles.section} ${styles.contact}`} id="contato" aria-labelledby="contact-title">
      <div><p className={styles.eyebrow}>CONTROLE QUE ACOMPANHA CADA VALOR</p>
        <h2 id="contact-title">Um novo fluxo<br />para o seu escritório.</h2></div>
      <div className={styles.contactAction}>
        <p>{contactHref ? "Converse com a equipe para conhecer a Repassum e organizar o próximo passo do seu escritório."
          : "O acesso é feito por convite. Para começar, fale com o administrador responsável pelo seu escritório."}</p>
        {contactHref ? <a href={contactHref} className={styles.contactButton}>Falar com a equipe <span aria-hidden="true">↗</span></a>
          : <Link href="/login" className={styles.contactButton}>Já tenho acesso <span aria-hidden="true">↗</span></Link>}
        <small>Ambientes individuais. Acessos por função.</small>
      </div>
    </section>
    </main>
    <footer className={styles.footer}>
      <Link href="/#inicio" className={styles.brand} aria-label="Repassum, voltar ao início"><RepassumLogo light /></Link>
      <p>Clareza em cada etapa.</p><Link href="/login">Acessar a plataforma <span aria-hidden="true">↗</span></Link>
    </footer>
  </div>;
}
