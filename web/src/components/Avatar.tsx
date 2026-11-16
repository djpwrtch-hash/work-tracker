import { useState, useEffect } from 'react';
import { getInitials } from '@/lib/utils';

interface AvatarProps {
  user?: { firstName?: string; lastName?: string; profilePictureUrl?: string | null } | null;
  /** Explicit image URL (takes precedence over user.profilePictureUrl). */
  src?: string | null;
  firstName?: string;
  lastName?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  alt?: string;
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'h-6 w-6 text-[10px] rounded-md',
  sm: 'h-8 w-8 text-xs rounded-lg',
  md: 'h-9 w-9 text-sm rounded-xl',
  lg: 'h-20 w-20 text-2xl rounded-2xl',
  xl: 'h-24 w-24 text-3xl rounded-2xl',
};

export default function Avatar({ user, src, firstName, lastName, size = 'md', className = '', alt }: AvatarProps) {
  const [imgError, setImgError] = useState(false);
  const f = firstName ?? user?.firstName;
  const l = lastName ?? user?.lastName;
  const imageUrl = src ?? user?.profilePictureUrl ?? null;

  // Reset the error state when the image url changes
  useEffect(() => { setImgError(false); }, [imageUrl]);

  const shape = SIZE_CLASSES[size];
  const common = `inline-flex items-center justify-center font-bold text-violet-400 bg-violet-500/15 border border-violet-500/20 shrink-0 overflow-hidden ${shape} ${className}`;

  if (imageUrl && !imgError) {
    return (
      <img
        src={imageUrl}
        alt={alt ?? (f ? `${f} ${l ?? ''}`.trim() : 'Profile')}
        onError={() => setImgError(true)}
        className={`${shape} ${className} object-cover shrink-0`}
      />
    );
  }
  return <span className={common}>{getInitials(f, l)}</span>;
}
