import { useEffect, useMemo, useRef, useState } from 'react';
import { BASELINE, STAMP_BORDER, STAMP_PAD, WATERMARK_SIZE, elementBox, stampLayout, textLayout, type MetricsFonts, type StudioElement, type StudioPage } from '../../lib/studio';
import type { StudioSources } from './sources';

const FONT = 'Helvetica, Arial, "Liberation Sans", "Nimbus Sans", sans-serif';

export function useRaster(sources: StudioSources, page: StudioPage, pxWidth: number) {
  const [url, setUrl] = useState<string | null>(null);
  const bucket = Math.ceil(pxWidth / 256);
  const src = page.source;
  useEffect(() => {
    let dead = false;
    const t = setTimeout(() => {
      sources
        .raster(page, bucket * 256)
        .then((u) => !dead && setUrl(u))
        .catch(() => {});
    }, 80);
    return () => {
      dead = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, page.id, src?.docId, src?.index, page.bgDataUrl, bucket]);
  return url;
}

interface Props {
  page: StudioPage;
  scale: number;
  fonts: MetricsFonts;
  sources: StudioSources;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCheckpoint: () => void;
  onPatch: (id: string, patch: Partial<StudioElement>, transient: boolean) => void;
  onEditText: (id: string) => void;
}

type Drag = { id: string; mode: 'move' | 'resize' | 'resizeW'; sx: number; sy: number; orig: StudioElement; aspect: number };

export default function StudioCanvas({ page, scale: s, fonts, sources, selectedId, onSelect, onCheckpoint, onPatch, onEditText }: Props) {
  const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
  const bg = useRaster(sources, page, page.width * s * dpr);
  const drag = useRef<Drag | null>(null);

  const start = (e: React.PointerEvent, el: StudioElement, mode: Drag['mode']) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect(el.id);
    onCheckpoint();
    const box = elementBox(el, fonts);
    drag.current = { id: el.id, mode, sx: e.clientX, sy: e.clientY, orig: el, aspect: box.w / Math.max(1, box.h) };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.sx) / s;
    const dy = (e.clientY - d.sy) / s;
    const o = d.orig;
    if (d.mode === 'move') {
      const box = elementBox(o, fonts);
      const x = Math.min(page.width - 16, Math.max(16 - box.w, o.x + dx));
      const y = Math.min(page.height - 16, Math.max(16 - box.h, o.y + dy));
      onPatch(d.id, { x, y }, true);
    } else if (d.mode === 'resizeW' && o.type === 'text') {
      onPatch(d.id, { w: Math.max(30, Math.min(page.width * 2, o.w + dx)) }, true);
    } else if (d.mode === 'resize' && (o.type === 'image' || o.type === 'signature')) {
      const w = Math.max(16, o.w + dx);
      onPatch(d.id, { w, h: w / d.aspect }, true);
    } else if (d.mode === 'resize' && o.type === 'rect') {
      onPatch(d.id, { w: Math.max(8, o.w + dx), h: Math.max(8, o.h + dy) }, true);
    }
  };

  const end = () => {
    drag.current = null;
  };

  const rendered = useMemo(() => page.elements, [page.elements]);

  return (
    <div
      onPointerDown={(e) => e.target === e.currentTarget && onSelect(null)}
      className="relative shrink-0 select-none overflow-hidden bg-white text-slate-900 shadow-2xl ring-1 ring-black/10"
      style={{ width: page.width * s, height: page.height * s }}
    >
      {bg && <img src={bg} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full" />}

      {page.showWatermark && page.watermark.trim() && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center overflow-hidden">
          <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: WATERMARK_SIZE * s, color: 'rgb(148 163 184 / 0.3)', transform: 'rotate(-45deg)', whiteSpace: 'nowrap' }}>{page.watermark}</span>
        </div>
      )}

      {rendered.map((el) => {
        const selected = el.id === selectedId;
        const box = elementBox(el, fonts);
        return (
          <div
            key={el.id}
            onPointerDown={(e) => start(e, el, 'move')}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onDoubleClick={() => el.type === 'text' && onEditText(el.id)}
            style={{ position: 'absolute', left: el.x * s, top: el.y * s, width: box.w * s, height: box.h * s, touchAction: 'none', cursor: 'move', outline: selected ? '2px solid #6366f1' : undefined, outlineOffset: 3 }}
            className={selected ? '' : 'hover:outline hover:outline-1 hover:outline-offset-2 hover:outline-indigo-400/60'}
          >
            <ElementBody el={el} s={s} fonts={fonts} />
            {selected && (el.type === 'image' || el.type === 'signature' || el.type === 'rect') && (
              <Handle onDown={(e) => start(e, el, 'resize')} onMove={move} onUp={end} cls="-bottom-4 -right-4" cursor="nwse-resize" />
            )}
            {selected && el.type === 'text' && <Handle onDown={(e) => start(e, el, 'resizeW')} onMove={move} onUp={end} cls="-right-4 top-1/2 -translate-y-1/2" cursor="ew-resize" />}
          </div>
        );
      })}
    </div>
  );
}

function Handle({ onDown, onMove, onUp, cls, cursor }: { onDown: (e: React.PointerEvent) => void; onMove: (e: React.PointerEvent) => void; onUp: () => void; cls: string; cursor: string }) {
  return (
    <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} className={`absolute grid h-8 w-8 place-items-center ${cls}`} style={{ touchAction: 'none', cursor }}>
      <span className="h-3.5 w-3.5 rounded-full border-2 border-white bg-indigo-600 shadow" />
    </div>
  );
}

function ElementBody({ el, s, fonts }: { el: StudioElement; s: number; fonts: MetricsFonts }) {
  switch (el.type) {
    case 'text': {
      const lay = textLayout(el, fonts);
      return (
        <>
          {lay.lines.map((ln, i) => (
            <div key={i} style={{ height: lay.lh * s, lineHeight: `${lay.lh * s}px`, fontSize: el.fontSize * s, fontWeight: el.bold ? 700 : 400, color: el.color, whiteSpace: 'pre', fontFamily: FONT }}>
              {ln || ' '}
            </div>
          ))}
        </>
      );
    }
    case 'stamp': {
      const lay = stampLayout(el, fonts);
      return (
        <>
          <div style={{ position: 'absolute', inset: (-STAMP_BORDER / 2) * s, border: `${STAMP_BORDER * s}px solid ${el.color}`, boxSizing: 'border-box', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', left: STAMP_PAD * s, top: (lay.baseline - BASELINE * el.fontSize) * s, lineHeight: `${el.fontSize * 1.25 * s}px`, fontSize: el.fontSize * s, fontWeight: 700, color: el.color, whiteSpace: 'pre', fontFamily: FONT }}>
            {lay.text}
          </div>
        </>
      );
    }
    case 'rect':
      return <div style={{ width: '100%', height: '100%', background: el.color, opacity: el.opacity }} />;
    default:
      return <img src={el.dataUrl} alt="" draggable={false} style={{ width: '100%', height: '100%', pointerEvents: 'none' }} />;
  }
}
