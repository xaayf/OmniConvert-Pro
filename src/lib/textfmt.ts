import type { Block } from './pdfBuild';

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Markdown inline minimal: **tebal**, *miring*, `kode`, [teks](url http/https/mailto saja). Input di-escape dulu. */
export function inlineMd(text: string): string {
  let t = escapeHtml(text);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  t = t.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)/g, '<a href="$2" rel="noopener noreferrer">$1</a>');
  return t;
}

/** Hapus penanda markdown inline untuk keluaran teks polos. */
export function stripInlineMd(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1$2')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

export function mdToBlocks(md: string, keepInline = false): Block[] {
  const blocks: Block[] = [];
  const clean = (t: string) => (keepInline ? t : stripInlineMd(t));
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let para: string[] = [];
  let inCode = false;
  let code: string[] = [];

  const flush = () => {
    if (para.length) {
      blocks.push({ kind: 'p', text: clean(para.join(' ')) });
      para = [];
    }
  };

  for (const raw of lines) {
    if (/^```/.test(raw)) {
      if (inCode) {
        blocks.push({ kind: 'pre', text: code.join('\n') });
        code = [];
      } else flush();
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      code.push(raw);
      continue;
    }
    const line = raw.trimEnd();
    let m: RegExpMatchArray | null;
    if (line.trim() === '') {
      flush();
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flush();
      blocks.push({ kind: m[1].length === 1 ? 'h1' : m[1].length === 2 ? 'h2' : 'h3', text: clean(m[2]) });
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flush();
      blocks.push({ kind: 'hr', text: '' });
    } else if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
      flush();
      blocks.push({ kind: 'li', text: clean(m[1]), marker: '•' });
    } else if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)$/))) {
      flush();
      blocks.push({ kind: 'li', text: clean(m[2]), marker: `${m[1]}.` });
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flush();
      blocks.push({ kind: 'p', text: clean(m[1]) });
    } else {
      para.push(line.trim());
    }
  }
  if (inCode && code.length) blocks.push({ kind: 'pre', text: code.join('\n') });
  flush();
  return blocks;
}

export function blocksToText(blocks: Block[]): string {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.kind === 'br') out.push('');
    else if (b.kind === 'hr') out.push('----------');
    else if (b.kind === 'li') out.push(`${b.marker ?? '•'} ${b.text}`);
    else out.push(b.text);
    if (!b.tight && b.kind !== 'li' && b.kind !== 'br') out.push('');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

const HTML_CSS = `
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; max-width: 820px; margin: 40px auto; padding: 0 20px; line-height: 1.65; color: #1e293b; }
  h1,h2,h3 { line-height: 1.25; color: #0f172a; }
  pre { background: #f1f5f9; padding: 14px 16px; border-radius: 10px; overflow-x: auto; }
  code { background: #f1f5f9; padding: 1px 5px; border-radius: 5px; font-size: .92em; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { border: 1px solid #cbd5e1; padding: 7px 10px; text-align: left; vertical-align: top; }
  th { background: #eef2ff; }
  tr:nth-child(even) td { background: #f8fafc; }
  @media (prefers-color-scheme: dark) { body { background:#0b1020; color:#e2e8f0 } h1,h2,h3 { color:#f8fafc } pre,code { background:#1e293b } th { background:#1e1b4b } th,td { border-color:#334155 } tr:nth-child(even) td { background:#111827 } }
`;

export function wrapHtmlDoc(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${HTML_CSS}</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}

export function blocksToHtml(blocks: Block[], title: string, withInlineMd = false): string {
  const t = (s: string) => (withInlineMd ? inlineMd(s) : escapeHtml(s));
  const parts: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const closeList = () => {
    if (list) parts.push(`</${list}>`);
    list = null;
  };
  for (const b of blocks) {
    if (b.kind !== 'li') closeList();
    switch (b.kind) {
      case 'h1': parts.push(`<h1>${t(b.text)}</h1>`); break;
      case 'h2': parts.push(`<h2>${t(b.text)}</h2>`); break;
      case 'h3': parts.push(`<h3>${t(b.text)}</h3>`); break;
      case 'p': parts.push(`<p>${t(b.text)}</p>`); break;
      case 'pre': parts.push(`<pre>${escapeHtml(b.text)}</pre>`); break;
      case 'hr': parts.push('<hr>'); break;
      case 'br': break;
      case 'li': {
        const want = b.marker && /\d/.test(b.marker) ? 'ol' : 'ul';
        if (list !== want) {
          closeList();
          parts.push(`<${want}>`);
          list = want;
        }
        parts.push(`<li>${t(b.text)}</li>`);
        break;
      }
    }
  }
  closeList();
  return wrapHtmlDoc(title, parts.join('\n'));
}

/** HTML -> blok terstruktur. Format inline (tebal/miring) sengaja diratakan; tabel dijadikan baris "a | b | c". */
export function htmlToBlocks(html: string): Block[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,template').forEach((n) => n.remove());
  const blocks: Block[] = [];
  const norm = (s: string | null) => (s ?? '').replace(/\s+/g, ' ').trim();

  const handleList = (list: Element) => {
    const ordered = list.tagName.toLowerCase() === 'ol';
    let n = 1;
    for (const li of Array.from(list.children)) {
      if (li.tagName.toLowerCase() !== 'li') continue;
      const own = Array.from(li.childNodes)
        .filter((c) => !(c instanceof Element && /^(ul|ol)$/i.test(c.tagName)))
        .map((c) => c.textContent ?? '')
        .join('');
      const text = norm(own);
      if (text) blocks.push({ kind: 'li', text, marker: ordered ? `${n}.` : '•' });
      n++;
      for (const sub of Array.from(li.children)) if (/^(ul|ol)$/i.test(sub.tagName)) handleList(sub);
    }
  };

  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        const lvl = Number(tag[1]);
        const text = norm(child.textContent);
        if (text) blocks.push({ kind: lvl === 1 ? 'h1' : lvl === 2 ? 'h2' : 'h3', text });
      } else if (tag === 'p' || tag === 'blockquote' || tag === 'figcaption') {
        const text = norm(child.textContent);
        if (text) blocks.push({ kind: 'p', text });
      } else if (tag === 'ul' || tag === 'ol') {
        handleList(child);
      } else if (tag === 'pre') {
        blocks.push({ kind: 'pre', text: (child.textContent ?? '').replace(/\n+$/, '') });
      } else if (tag === 'hr') {
        blocks.push({ kind: 'hr', text: '' });
      } else if (tag === 'table') {
        child.querySelectorAll('tr').forEach((tr, i) => {
          const cells = Array.from(tr.children).map((c) => norm(c.textContent));
          if (cells.some(Boolean)) blocks.push({ kind: i === 0 && tr.querySelector('th') ? 'h3' : 'p', text: cells.join(' | '), tight: true });
        });
        blocks.push({ kind: 'br', text: '' });
      } else {
        // div/section/body dst: telusuri anak; jika tidak punya anak elemen, anggap paragraf.
        if (child.children.length) walk(child);
        else {
          const text = norm(child.textContent);
          if (text) blocks.push({ kind: 'p', text });
        }
      }
    }
  };
  walk(doc.body);
  if (!blocks.length) {
    const text = norm(doc.body.textContent);
    if (text) blocks.push({ kind: 'p', text });
  }
  return blocks;
}

/**
 * Gabungkan baris hasil ekstraksi PDF menjadi paragraf: baris disambung kecuali
 * baris berakhir tanda baca kalimat, pendek, atau baris berikut diawali penanda daftar.
 */
export function reflowLines(lines: string[]): string[] {
  const clean = lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter((l, i, a) => l || (a[i - 1] ?? '') !== '');
  const maxLen = Math.max(1, ...clean.map((l) => l.length));
  const paras: string[] = [];
  let cur = '';
  for (let i = 0; i < clean.length; i++) {
    const l = clean[i];
    if (!l) {
      if (cur) paras.push(cur);
      cur = '';
      continue;
    }
    cur = cur ? `${cur} ${l}` : l;
    const next = clean[i + 1];
    const endsSentence = /[.!?:;]$/.test(l);
    const short = l.length < maxLen * 0.55;
    const nextIsItem = !!next && /^([-•*]|\d+[.)])\s/.test(next);
    if (!next || endsSentence || short || nextIsItem) {
      paras.push(cur);
      cur = '';
    }
  }
  if (cur) paras.push(cur);
  return paras;
}
