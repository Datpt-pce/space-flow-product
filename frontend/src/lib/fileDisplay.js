import { Image, Video, Music, File } from 'lucide-react';

// Dùng chung cho ListNodeBeta và các node hiển thị file khác.

export function fileIcon(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif'].includes(ext)) return Image;
  if (['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext)) return Video;
  if (['mp3', 'wav', 'aac', 'flac', 'ogg'].includes(ext)) return Music;
  return File;
}

export function displayName(filePath) {
  const name = filePath.replace(/\\/g, '/').split('/').pop();
  return name.replace(/^\d{13}-/, '');
}

export function isImage(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'].includes(ext);
}

export function isVideo(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  return ['mp4', 'mov', 'avi', 'mkv', 'webm'].includes(ext);
}
