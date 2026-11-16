import { useState, useEffect } from 'react';
import { getInitials } from '@/lib/utils';
import PhotoViewer from './PhotoViewer';

interface AvatarProps {
  user?: { id?: string; firstName?: string; lastName?: string; profilePictureUrl?: string | null } | null;
  /** Explicit image URL (takes precedence over user.profilePictureUrl). */
  src?: string | null;
  firstName?: string;
  lastName?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  alt?: string;
  /** When provided, clicking the photo opens a full-size viewer (read-only for others, editable for self). */
  currentUserId?: string;
  /** Force edit mode off even if currentUserId matches user.id */
  readOnly?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'h-6 w-6 text-[10px] rounded-md',
  sm: 'h-8 w-8 text-xs rounded-lg',
  md: 'h-9 w-9 text-sm rounded-xl',
  lg: 'h-20 w-20 text-2xl rounded-2xl',
  xl: 'h-24 w-24 text-3xl rounded-2xl',
};

export default function Avatar({ user, src, firstName, lastName, size = 'md', className = '', alt, currentUserId, readOnly = false }: AvatarProps) {
  const [imgError, setImgError] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const f = firstName ?? user?.firstName;
  const l = lastName ?? user?.lastName;
  const imageUrl = src ?? user?.profilePictureUrl ?? null;

  // Reset the error state when the image url changes
  useEffect(() => { setImgError(false); }, [imageUrl]);

  const shape = SIZE_CLASSES[size];
  const common = `inline-flex items-center justify-center font-bold text-violet-400 bg-violet-500/15 border border-violet-500/20 shrink-0 overflow-hidden ${shape} ${className}`;
  const isOwner = !!currentUserId && !!user?.id && currentUserId === user.id && !readOnly;

  if (imageUrl && !imgError) {
    const img = (
      <img
        src={imageUrl}
        alt={alt ?? (f ? `${f} ${l ?? ''}`.trim() : 'Profile')}
        onError={() => setImgError(true)}
        className={`${shape} ${className} object-cover shrink-0`}
      />
    );
    if (!currentUserId) return img;
    return (
      <>
        <button type="button" onClick={() => setViewerOpen(true)} aria-label="View photo" className={`${shape} ${className} overflow-hidden shrink-0`}>
          {img}
        </button>
        {viewerOpen && <PhotoViewer imageUrl={imageUrl} firstName={f} lastName={l} editable={isOwner} onClose={() => setViewerOpen(false)} />}
      </>
    );
  }
  return <span className={common}>{getInitials(f, l)}</span>;
}
