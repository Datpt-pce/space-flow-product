import * as LucideIcons from 'lucide-react';
import { Box } from 'lucide-react';

function toPascalCase(kebab) {
  return kebab.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('');
}

// Chuyển tên icon kebab-case trong node.json (vd. "file-archive") sang
// đúng component lucide-react — tự chạy được cho mọi node hiện tại lẫn
// tương lai, không cần thêm code riêng cho từng node.
export function getNodeIcon(iconName) {
  if (!iconName) return Box;
  return LucideIcons[toPascalCase(iconName)] || Box;
}
