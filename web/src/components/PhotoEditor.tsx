import { useEffect, useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import { Loader2, X, Check, RotateCcw } from 'lucide-react';
import { api, getApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { toast } from 'sonner';

interface PhotoEditorProps {
  imageUrl: string;
  onClose: () => void;
  onSaved: () => void;
}

const PRESETS = [
  { label: 'Original', filter: '' },
  { label: 'Grayscale', filter: 'grayscale(1)' },
  { label: 'Sepia', filter: 'sepia(1)' },
  { label: 'Vintage', filter: 'sepia(0.5) contrast(0.9) brightness(1.1) saturate(0.85)' },
  { label: 'Cool', filter: 'hue-rotate(200deg) saturate(0.85)' },
  { label: 'Warm', filter: 'sepia(0.3) saturate(1.35) hue-rotate(-12deg)' },
];

function createImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/** Draw the cropped region of the image onto a canvas with the given filter, return a JPEG blob. */
async function cropAndFilter(imageUrl: string, crop: { x: number; y: number; width: number; height: number }, filter: string): Promise<Blob> {
  const img = await createImage(imageUrl);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(crop.width));
  canvas.height = Math.max(1, Math.round(crop.height));
  const ctx = canvas.getContext('2d')!;
  ctx.filter = filter || 'none';
  ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to encode image'))), 'image/jpeg', 0.92);
  });
}

export default function PhotoEditor({ imageUrl, onClose, onSaved }: PhotoEditorProps) {
  const { refreshProfile } = useAuth();
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [preset, setPreset] = useState(0);
  const [brightness, setBrightness] = useState(1);
  const [contrast, setContrast] = useState(1);
  const [saturation, setSaturation] = useState(1);
  const [blur, setBlur] = useState(0);
  const [saving, setSaving] = useState(false);

  const combinedFilter = useCallback(() => {
    const parts = [PRESETS[preset].filter];
    if (brightness !== 1) parts.push(`brightness(${brightness})`);
    if (contrast !== 1) parts.push(`contrast(${contrast})`);
    if (saturation !== 1) parts.push(`saturate(${saturation})`);
    if (blur > 0) parts.push(`blur(${blur}px)`);
    return parts.filter(Boolean).join(' ');
  }, [preset, brightness, contrast, saturation, blur]);

  const onCropComplete = useCallback((_area: any, croppedPixels: { x: number; y: number; width: number; height: number }) => {
    setCroppedArea(croppedPixels);
  }, []);

  const handleSave = async () => {
    if (!croppedArea) { toast.error('Wait for the image to load'); return; }
    setSaving(true);
    try {
      const blob = await cropAndFilter(imageUrl, croppedArea, combinedFilter());
      const form = new FormData();
      form.append('photo', blob, 'profile.jpg');
      await api.post('/profile-photo', form, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success('Photo updated');
      await refreshProfile();
      onSaved();
    } catch (e: any) {
      toast.error(getApiError(e, 'Failed to save photo'));
    } finally {
      setSaving(false);
    }
  };

  // If the image fails to load, show an error
  const [imageError, setImageError] = useState(false);
  useEffect(() => {
    const img = new Image();
    img.onload = () => setImageError(false);
    img.onerror = () => setImageError(true);
    img.src = imageUrl;
  }, [imageUrl]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label="Edit photo">
      <div className="w-full max-w-lg max-h-[95vh] overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Edit photo</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
        </div>

        {imageError ? (
          <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-6 text-center text-sm text-rose-300">Could not load image. Check your connection and try again.</div>
        ) : (
          <>
            <div className="relative w-full aspect-square overflow-hidden rounded-xl bg-black">
              <Cropper
                image={imageUrl}
                crop={crop}
                zoom={zoom}
                aspect={1}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
                style={{ containerStyle: { position: 'absolute', inset: 0 } }}
              />
            </div>

            <div>
              <label className="mb-1 flex items-center justify-between text-xs text-slate-400"><span>Zoom</span><span>{zoom.toFixed(1)}x</span></label>
              <input type="range" min={1} max={3} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-full accent-violet-500" />
            </div>

            <div>
              <p className="mb-1 text-xs text-slate-400">Filter</p>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p, i) => (
                  <button key={p.label} onClick={() => setPreset(i)}
                    className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition ${preset === i ? 'border-violet-500 bg-violet-600 text-white' : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-slate-600'}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {([
                ['Brightness', brightness, setBrightness, 0.5, 1.5, 0.05],
                ['Contrast', contrast, setContrast, 0.5, 1.5, 0.05],
                ['Saturation', saturation, setSaturation, 0, 2, 0.05],
                ['Blur', blur, setBlur, 0, 5, 0.5],
              ] as [string, number, (v: number) => void, number, number, number][]).map(([label, value, set, min, max, step]) => (
                <div key={label}>
                  <label className="mb-1 flex items-center justify-between text-[11px] text-slate-400"><span>{label}</span><span>{value.toFixed(2)}</span></label>
                  <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} className="w-full accent-violet-500" />
                </div>
              ))}
            </div>

            <button type="button" onClick={() => { setPreset(0); setBrightness(1); setContrast(1); setSaturation(1); setBlur(0); setZoom(1); setCrop({ x: 0, y: 0 }); }}
              className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-white transition">
              <RotateCcw className="h-3.5 w-3.5" />Reset adjustments
            </button>

            <div className="flex gap-2">
              <button onClick={onClose} className="flex-1 rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 hover:bg-slate-800 transition">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 transition disabled:opacity-50">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Save
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
