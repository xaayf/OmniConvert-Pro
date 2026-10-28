import { Document, Packer, Paragraph, TextRun, HeadingLevel, BorderStyle } from 'docx';
import TurndownService from 'turndown';
import type { Block } from '../pdfBuild';

/** Bangun .docx asli (OOXML) dari blok terstruktur. Tiap elemen `pages` dimulai di halaman baru. */
export async function blocksToDocx(pages: Block[][], title: string): Promise<Blob> {
  const children: Paragraph[] = [];
  pages.forEach((blocks, pi) => {
    let first = pi > 0;
    for (const b of blocks) {
      const pageBreakBefore = first;
      first = false;
      switch (b.kind) {
        case 'h1':
        case 'h2':
        case 'h3':
          children.push(
            new Paragraph({
              heading: b.kind === 'h1' ? HeadingLevel.HEADING_1 : b.kind === 'h2' ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
              children: [new TextRun(b.text)],
              pageBreakBefore
            })
          );
          break;
        case 'li':
          children.push(
            new Paragraph({
              children: [new TextRun(`${b.marker ?? '•'}\t${b.text}`)],
              indent: { left: 540, hanging: 300 },
              spacing: { after: 60 },
              pageBreakBefore
            })
          );
          break;
        case 'pre':
          children.push(
            new Paragraph({
              children: b.text.split('\n').map((l, i) => new TextRun({ text: l, font: 'Courier New', size: 19, break: i ? 1 : 0 })),
              spacing: { after: 120 },
              pageBreakBefore
            })
          );
          break;
        case 'hr':
          children.push(
            new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CBD5E1', space: 1 } }, children: [], pageBreakBefore })
          );
          break;
        case 'br':
          children.push(new Paragraph({ children: [], pageBreakBefore }));
          break;
        default:
          children.push(
            new Paragraph({ children: [new TextRun(b.text)], spacing: { after: b.tight ? 40 : 140 }, pageBreakBefore })
          );
      }
    }
    if (!blocks.length && pi > 0) children.push(new Paragraph({ children: [], pageBreakBefore: true }));
  });

  const doc = new Document({
    creator: 'OmniConvert Pro',
    title,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [{ children: children.length ? children : [new Paragraph('')] }]
  });
  return Packer.toBlob(doc);
}

let turndown: TurndownService | null = null;
export function htmlToMarkdown(html: string): string {
  if (!turndown) {
    turndown = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
    turndown.addRule('img', { filter: 'img', replacement: (_c, node) => `_[${(node as HTMLElement).getAttribute('alt') || 'gambar'}]_` });
  }
  return turndown.turndown(html).trim() + '\n';
}
