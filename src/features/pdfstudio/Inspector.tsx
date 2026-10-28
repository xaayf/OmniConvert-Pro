import { type RefObject } from 'react';
import { ArrowDownToLine, ArrowUpToLine, Bold, ImageOff, ImagePlus, Trash2 } from 'lucide-react';
import { Button, Field, cx } from '../../components/ui';
import type { StudioElement, StudioPage } from '../../lib/studio';

const SWATCHES = ['#0f172a', '#dc2626', '#2563eb', '#059669', '#d97706', '#7c3aed', '#facc15', '#ffffff'];

function Swatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {SWATCHES.map((c) => (
        <button key={c} aria-label={`Warna ${c}`} onClick={() => onChange(c)} style={{ background: c }} className={cx('h-7 w-7 rounded-full border-2 transition', value.toLowerCase() === c ? 'scale-110 border-indigo-500 ring-2 ring-indigo-500/40' : 'border-slate-300 dark:border-white/30')} />
      ))}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Warna kustom" className="h-7 w-9 cursor-pointer rounded border-0 bg-transparent p-0" />
    </div>
  );
}

interface Props {
  el: StudioElement | null;
  page: StudioPage | null;
  textRef: RefObject<HTMLTextAreaElement | null>;
  onPatch: (patch: Partial<StudioElement>, key?: string) => void;
  onDelete: () => void;
  onLayer: (dir: 1 | -1) => void;
  onPagePatch: (patch: Partial<Pick<StudioPage, 'watermark' | 'showWatermark' | 'bgDataUrl'>>, key?: string) => void;
  onPickBackground: () => void;
}

export default function Inspector({ el, page, textRef, onPatch, onDelete, onLayer, onPagePatch, onPickBackground }: Props) {
  if (!page) return null;

  if (!el) {
    return (
      <div className="space-y-4">
        <p className="section-title">Properti halaman</p>
        <label className="glass-chip flex cursor-pointer items-center justify-between rounded-xl p-3">
          <span className="text-xs font-semibold">Watermark diagonal</span>
          <input type="checkbox" checked={page.showWatermark} onChange={(e) => onPagePatch({ showWatermark: e.target.checked })} className="h-4 w-4 accent-indigo-600" />
        </label>
        {page.showWatermark && <input value={page.watermark} onChange={(e) => onPagePatch({ watermark: e.target.value }, 'wm')} placeholder="Teks watermark" className="glass-input h-10 w-full px-3" />}
        {!page.source && (
          <div className="flex gap-2">
            <Button size="sm" icon={ImagePlus} onClick={onPickBackground}>
              Latar gambar
            </Button>
            {page.bgDataUrl && <Button size="sm" variant="danger" icon={ImageOff} onClick={() => onPagePatch({ bgDataUrl: undefined })}>Hapus latar</Button>}
          </div>
        )}
        <p className="rounded-xl bg-slate-500/10 p-3 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
          Ketuk elemen di halaman untuk mengedit. Seret untuk memindah; tarik titik biru untuk mengubah ukuran. Teks asli di dalam PDF tidak bisa diubah — tambahkan teks baru di atasnya.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="section-title">{{ text: 'Teks', stamp: 'Stempel', image: 'Gambar', signature: 'Tanda tangan', rect: 'Kotak' }[el.type]}</p>
        <div className="flex items-center">
          <Button size="sm" variant="ghost" iconOnly icon={ArrowUpToLine} onClick={() => onLayer(1)} aria-label="Bawa ke depan" />
          <Button size="sm" variant="ghost" iconOnly icon={ArrowDownToLine} onClick={() => onLayer(-1)} aria-label="Kirim ke belakang" />
          <Button size="sm" variant="danger" iconOnly icon={Trash2} onClick={onDelete} aria-label="Hapus elemen" />
        </div>
      </div>

      {el.type === 'text' && (
        <>
          <textarea ref={textRef} rows={4} value={el.text} onChange={(e) => onPatch({ text: e.target.value }, `t-${el.id}`)} className="glass-input w-full resize-y p-3" />
          <Field label="Ukuran huruf" value={`${el.fontSize} pt`}>
            <input type="range" min={7} max={72} value={el.fontSize} onChange={(e) => onPatch({ fontSize: Number(e.target.value) }, `fs-${el.id}`)} />
          </Field>
          <Field label="Lebar kotak" value={`${Math.round(el.w)} pt`}>
            <input type="range" min={40} max={Math.max(120, Math.round(page.width))} value={el.w} onChange={(e) => onPatch({ w: Number(e.target.value) }, `w-${el.id}`)} />
          </Field>
          <div className="flex items-center justify-between gap-3">
            <Swatches value={el.color} onChange={(color) => onPatch({ color })} />
            <Button size="sm" variant={el.bold ? 'primary' : 'secondary'} iconOnly icon={Bold} onClick={() => onPatch({ bold: !el.bold })} aria-pressed={el.bold} aria-label="Tebal" />
          </div>
          <p className="text-[11px] text-slate-500">Font standar PDF (Helvetica): huruf Latin; emoji/aksara non-Latin diganti “?”.</p>
        </>
      )}

      {el.type === 'stamp' && (
        <>
          <input value={el.text} onChange={(e) => onPatch({ text: e.target.value }, `t-${el.id}`)} className="glass-input h-10 w-full px-3 font-bold uppercase" />
          <Field label="Ukuran" value={`${el.fontSize} pt`}>
            <input type="range" min={10} max={48} value={el.fontSize} onChange={(e) => onPatch({ fontSize: Number(e.target.value) }, `fs-${el.id}`)} />
          </Field>
          <Swatches value={el.color} onChange={(color) => onPatch({ color })} />
        </>
      )}

      {el.type === 'rect' && (
        <>
          <Swatches value={el.color} onChange={(color) => onPatch({ color })} />
          <Field label="Opasitas" value={`${Math.round(el.opacity * 100)}%`}>
            <input type="range" min={5} max={100} value={Math.round(el.opacity * 100)} onChange={(e) => onPatch({ opacity: Number(e.target.value) / 100 }, `o-${el.id}`)} />
          </Field>
          <p className="rounded-xl bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
            Kotak hanya menutupi secara <b>visual</b>; teks di bawahnya tetap ada di file. Untuk menyembunyikan data sensitif, nyalakan <b>“Ratakan jadi gambar”</b> saat menyimpan.
          </p>
        </>
      )}

      {(el.type === 'image' || el.type === 'signature') && (
        <Field label="Lebar" value={`${Math.round(el.w)} pt`}>
          <input type="range" min={20} max={Math.max(100, Math.round(page.width))} value={el.w} onChange={(e) => { const w = Number(e.target.value); onPatch({ w, h: (w / el.w) * el.h }, `w-${el.id}`); }} />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="X (pt)">
          <input type="number" value={Math.round(el.x)} onChange={(e) => onPatch({ x: Number(e.target.value) }, `x-${el.id}`)} className="glass-input h-10 w-full px-3" />
        </Field>
        <Field label="Y (pt)">
          <input type="number" value={Math.round(el.y)} onChange={(e) => onPatch({ y: Number(e.target.value) }, `y-${el.id}`)} className="glass-input h-10 w-full px-3" />
        </Field>
      </div>
    </div>
  );
}
