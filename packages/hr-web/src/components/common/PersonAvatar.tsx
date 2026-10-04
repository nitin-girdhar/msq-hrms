'use client';

import { PhotoAvatar } from '@platform/ui-kit';

const SIZES = { xs: 'h-6 w-6', sm: 'h-9 w-9', md: 'h-11 w-11', lg: 'h-16 w-16' } as const;

/**
 * A person's photo when they have one, their initial otherwise. The photo is the enrolled profile
 * photo served by identity-service at an authenticated, same-origin URL; PhotoAvatar falls back to the
 * initial when that URL answers 404, so a person with no photo costs one failed image request.
 */
export default function PersonAvatar({ name, userId, size = 'sm', className = '' }: {
  name: string;
  userId?: string | null | undefined;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <PhotoAvatar
      src={userId ? `/api/users/${userId}/photo` : null}
      label={name}
      sizeClass={`${SIZES[size]} ${size === 'lg' ? 'text-xl' : ''}`}
      className={className}
    />
  );
}
