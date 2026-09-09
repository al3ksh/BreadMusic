import type { ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight, Cookie, FileText, Scale, Shield } from 'lucide-react';
import styles from './legal.module.css';

const documents = [
  { href: '/privacy', label: 'Privacy', icon: Shield },
  { href: '/cookies', label: 'Cookies', icon: Cookie },
  { href: '/terms', label: 'Terms', icon: FileText },
  { href: '/license', label: 'License', icon: Scale },
];

export function LegalLayout({ active, children }: { active: string; children: ReactNode }) {
  return <div className={styles.page}>
    <header className={styles.header}><a href="/" className={styles.brand}><img src="/assets/breadicon.png" alt="" width={34} height={34} />Bread <span>/ Legal</span></a><a href="/">Back to Bread <ArrowUpRight size={16} /></a></header>
    <div className={styles.layout}>
      <aside><nav aria-label="Legal documents">{documents.map(({ href, label, icon: Icon }) => <a key={href} href={href} aria-current={active === href ? 'page' : undefined}><Icon size={18} />{label}<ArrowUpRight size={14} /></a>)}</nav><a className={styles.back} href="/"><ArrowLeft size={15} />Back to home</a></aside>
      <main className={styles.document}>{children}</main>
    </div>
    <footer className={styles.footer}><span>&copy; {new Date().getFullYear()} &middot; Made by <a href="https://aleksh.xyz">aleksh</a></span><a href="https://github.com/al3ksh/BreadMusic" target="_blank" rel="noreferrer">Source on GitHub <ArrowUpRight size={14} /></a></footer>
  </div>;
}
