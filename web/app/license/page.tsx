import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { LegalLayout } from '@/components/legal/LegalLayout';

export default async function LicensePage() {
  const license = await readFile(path.join(process.cwd(), 'public', 'LICENSE.txt'), 'utf8');
  return <LegalLayout active="/license"><div>
    <h1>License</h1><p>GNU Affero General Public License &middot; Version 3</p>
    <section><h2>Free software, open source.</h2><p>Bread is licensed under AGPL-3.0-only and provided without warranty.</p><p><a href="https://github.com/al3ksh/BreadMusic" target="_blank" rel="noreferrer">View source on GitHub</a> &middot; <a href="/LICENSE.txt" download>Download license</a></p></section>
    <pre>{license}</pre>
  </div></LegalLayout>;
}
