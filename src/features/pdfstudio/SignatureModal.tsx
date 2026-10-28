import { useEffect, useRef, useState } from 'react';
import { Eraser, Check } from 'lucide-react';
import { Button, Modal, cx } from '../../components/ui';

const W = 840;
const H = 320;
const PENS = ['#111827', '#1d4ed8', '#7f1d1d'];

export interface SignatureResult {
  dataUrl: string;
  w: number;
  h: number;
}

/** Pad tanda tangan: pointer events (mouse/sentuh/Apple Pencil), garis dihaluskan, hasil dipangkas ke area tinta. */
export default function SignatureModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (r: SignatureResult) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [pen, setPen] = useState(PENS[0]);
  const [empty, setEmpty] = useState(true);
  const [warn, setWarn] = useState(false);

  useEffect(() => {
    if (open) {
      setEmpty(true);
      setWarn(false);
      ref.current?.getContext('2d')?.clearRect(0, 0, W, H);
    }
  }, [open]);

  const pos = (e: React.PointerEvent) => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  const down = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = pos(e);
    last.current = p;
    const ctx = ref.current!.getContext('2d')!;
    ctx.fillStyle = pen;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); // titik tunggal tetap terlihat
    ctx.fill();
    setEmpty(false);
    setWarn(false);
  };

  const move = (e: React.PointerEvent) => {
    if (!drawing.current || !last.current) return;
    const ctx = ref.current!.getContext('2d')!;
    const p = pos(e);
    const mid = { x: (last.current.x + p.x) / 2, y: (last.current.y + p.y) / 2 };
    ctx.strokeStyle = pen;
    ctx.lineWidth = e.pressure && e.pointerType === 'pen' ? 1.5 + e.pressure * 4 : 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.quadraticCurveTo(last.current.x, last.current.y, mid.x, mid.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  };

  const up = () => {
    drawing.current = false;
    last.current = null;
  };

  const clear = () => {
    ref.current?.getContext('2d')?.clearRect(0, 0, W, H);
    setEmpty(true);
  };

  const done = () => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    const { data } = ctx.getImageData(0, 0, W, H);
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (data[(y * W + x) * 4 + 3] > 8) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    if (x1 < 0) return setWarn(true);
    const pad = 8;
    x0 = Math.max(0, x0 - pad);
    y0 = Math.max(0, y0 - pad);
    x1 = Math.min(W - 1, x1 + pad);
    y1 = Math.min(H - 1, y1 + pad);
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1;
    out.height = y1 - y0 + 1;
    out.getContext('2d')!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    onDone({ dataUrl: out.toDataURL('image/png'), w: out.width, h: out.height });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Buat tanda tangan"
      subtitle="Goreskan dengan jari, mouse, atau Apple Pencil"
      footer={
        <>
          <Button icon={Eraser} onClick={clear} disabled={empty}>
            Bersihkan
          </Button>
          <Button variant="primary" icon={Check} onClick={done}>
            Tempel ke halaman
          </Button>
        </>
      }
    >
      <div className="mb-3 flex items-center gap-2">
        <span className="section-title">Warna pena</span>
        {PENS.map((c) => (
          <button key={c} onClick={() => setPen(c)} aria-label={`Pena ${c}`} style={{ background: c }} className={cx('h-7 w-7 rounded-full border-2 transition', pen === c ? 'scale-110 border-indigo-500 ring-2 ring-indigo-500/40' : 'border-white')} />
        ))}
      </div>
      <div className="relative overflow-hidden rounded-2xl border-2 border-dashed border-slate-300 bg-white dark:border-white/20">
        <canvas ref={ref} width={W} height={H} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} className="block aspect-[21/8] w-full cursor-crosshair" style={{ touchAction: 'none' }} />
        {empty && <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-slate-300">Tanda tangan di sini</p>}
        <div className="pointer-events-none absolute inset-x-6 bottom-9 border-b border-slate-300" />
      </div>
      {warn && <p role="alert" className="mt-2 text-xs font-semibold text-red-600">Tanda tangan masih kosong.</p>}
    </Modal>
  );
}
