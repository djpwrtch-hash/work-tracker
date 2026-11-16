import { useState } from 'react';
import { X, Pencil } from 'lucide-react';
import PhotoEditor from './PhotoEditor';

interface PhotoViewerProps {
  imageUrl: string | null;
  firstName?: string;
  lastName?: string;
  editable?: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export default function PhotoViewer({ imageUrl, firstName, lastName, editable = false, onClose, onSaved }: PhotoViewerProps) {
  const [editing, setEditing] = useState(false);

  if (editing && imageUrl) {
    return <PhotoEditor imageUrl={imageUrl} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onSaved?.(); }} />;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" role="dialog" aria-modal="true" aria-label="Profile photo" onClick={onClose}>
      <div className="relative" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Close" className="absolute -right-2 -top-2 z-10 rounded-full bg-slate-800 p-2 text-slate-300 hover:bg-slate-700 hover:text-white transition">
          <X className="h-5 w-5" />
        </button>
        {imageUrl ? (
          <img src={imageUrl} alt={`${firstName ?? ''} ${lastName ?? ''}`.trim() || 'Profile'} className="max-h-[80vh] max-w-[90vw] rounded-2xl object-contain" />
        ) : (
          <div className="flex h-64 w-64 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900 text-slate-500">No photo</div>
        )}
        {editable && imageUrl && (
          <button onClick={() => setEditing(true)} className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-slate-900/90 border border-slate-700 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 transition backdrop-blur">
            <Pencil className="h-4 w-4" />Edit photo
          </button>
        )}
      </div>
    </div>
  );
}
