const DRIVE_LETTERS = 'DEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// Quy đổi 1 path Windows do user dán tay (vd. "D:\Videos\a.mp4") sang path bên trong
// container Docker (vd. "/host-fs/drive-d/Videos/a.mp4"), dựa trên các mount đã khai báo
// trong docker-compose.yml. Chiều ngược lại (container -> Windows host) xem
// nodes/capcut-generate/capcut_generator.py:_to_host_path.
function toContainerPath(rawPath) {
  if (!rawPath || process.platform === 'win32') return rawPath;

  const p = String(rawPath).trim();

  // HOST_USERPROFILE luôn nằm trên ổ C: — phải kiểm tra trước nhánh ổ đĩa D-Z bên
  // dưới, nếu không path người dùng (vd. C:\Users\<ten>\Desktop\x.png) sẽ không bao
  // giờ khớp được vì ổ C không nằm trong danh sách ổ được mount riêng.
  const userProfile = process.env.HOST_USERPROFILE;
  if (userProfile && p.toLowerCase().startsWith(userProfile.toLowerCase())) {
    const rest = p.slice(userProfile.length).replace(/^[\\/]/, '').replace(/\\/g, '/');
    return rest ? `/host-fs/home/${rest}` : '/host-fs/home';
  }

  const driveMatch = p.match(/^([A-Za-z]):[\\/](.*)$/);
  if (driveMatch) {
    const letter = driveMatch[1].toUpperCase();
    const rest = driveMatch[2].replace(/\\/g, '/');
    if (DRIVE_LETTERS.includes(letter) && process.env[`HOST_DRIVE_${letter}`]) {
      return `/host-fs/drive-${letter.toLowerCase()}/${rest}`;
    }
  }

  return rawPath;
}

module.exports = { toContainerPath };
