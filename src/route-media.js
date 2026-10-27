import {VIDEO_MIME_TYPES} from './media-limits.js';

// Old records have a private path and videoMeta, but no explicit media type.
export function mediaType(route) {
  const type = route.photo?.type || route.mediaType || route.photoParts?.type;
  if (type) return type.split(';')[0];
  const extension = route.photoPath?.split('.').pop()?.toLowerCase();
  return {mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm',jpg:'image/jpeg',png:'image/png',webp:'image/webp'}[extension] || (route.videoMeta ? 'video/mp4' : '');
}
export const isVideo = route => VIDEO_MIME_TYPES.includes(mediaType(route));
export const mediaSize = route => route.photo?.size ?? route.photoParts?.size ?? route.mediaSize ?? 0;
