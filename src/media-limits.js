// Keep the original Supabase site's bucket contract independent of CloudBase.
const cloudbase = import.meta.env?.VITE_CLOUD_PROVIDER === 'cloudbase';
export const PHOTO_STORAGE_LIMIT = 20 * 1024 ** 2;
export const VIDEO_INPUT_LIMIT = 1024 ** 3;
export const MEDIA_STORAGE_LIMIT = cloudbase ? 1024 ** 3 : 20 * 1024 ** 2;
export const VIDEO_COMPRESSION_LIMIT = (cloudbase ? 200 : 20) * 1024 ** 2;
export const VIDEO_ORIGINAL_ENABLED = cloudbase;
export const VIDEO_MIME_TYPES = cloudbase ? ['video/mp4', 'video/quicktime', 'video/webm'] : ['video/mp4'];
export const VIDEO_DURATION_LIMIT = (cloudbase ? 20 : 10) * 60;
export const VIDEO_DEFAULT_QUALITY = cloudbase ? 'fast' : 'small';
export const BACKUP_FILE_LIMIT = (cloudbase ? 512 : 250) * 1024 ** 2;
export const mediaStorageLimit = type => VIDEO_MIME_TYPES.includes(type?.split(';')[0]) ? MEDIA_STORAGE_LIMIT : PHOTO_STORAGE_LIMIT;
