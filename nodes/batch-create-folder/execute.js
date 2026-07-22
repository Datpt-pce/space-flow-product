const fs = require('fs');
const path = require('path');

const ACCENT_FROM = 'ÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚÝàáâãèéêìíòóôõùúýĂăĐđĨĩŨũƠơƯưẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻẼẽẾếỀềỂểỄễỆệỈỉỊịỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨứỪừỬửỮữỰựỲỳỴỵỶỷỸỹ';
const ACCENT_TO   = 'AAAAEEEIIOOOOUUYaaaaeeeiioooouuyAaDdIiUuOoUuAaAaAaAaAaAaAaAaAaAaAaAaEeEeEeEeEeEeEeEeIiIiOoOoOoOoOoOoOoOoOoOoOoOoUuUuUuUuUuUuUuYyYyYyYy';

function removeAccents(text) {
  return text.split('').map(c => {
    const i = ACCENT_FROM.indexOf(c);
    return i >= 0 ? ACCENT_TO[i] : c;
  }).join('');
}

function formatName(text) {
  text = removeAccents(text);
  // Loại ký tự không hợp lệ với Windows path, thay bằng khoảng trắng
  text = text.replace(/[\x00-\x1f<>:"/\\|?*#\-_]+/g, ' ');
  // Mỗi từ viết hoa chữ đầu, ghép lại (CamelCase)
  return text.split(/\s+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join('');
}

function cartesianProduct(arrays) {
  return arrays.reduce((acc, arr) =>
    acc.flatMap(x => arr.map(y => [...x, y])), [[]]
  );
}

function parseTemplate(template) {
  if (!template.trim()) return [];
  return template.split('|').map(item => {
    item = item.trim();
    if (item.includes('/')) {
      const [parent, subs] = item.split('/', 2);
      return {
        folder: parent.trim(),
        subfolders: subs.split(',').map(s => s.trim().replace(/^#/, '')).filter(Boolean),
      };
    }
    return { folder: item, subfolders: [] };
  });
}

function parseItemsText(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cols = trimmed.split('\t').map(c => c.trim()).filter(Boolean);
    if (!cols.length) continue;
    rows.push({ text: cols[0], variants: cols.slice(1) });
  }
  return rows;
}

module.exports = async function execute(inputs, config, context) {
  let rows = [];

  // Priority: items_in port > items_text config
  if (Array.isArray(inputs?.items_in) && inputs.items_in.length > 0) {
    rows = inputs.items_in.map(item =>
      typeof item === 'string'
        ? { text: item, variants: [] }
        : { text: item.text || '', variants: item.variants || [] }
    );
  } else {
    rows = parseItemsText(config?.items_text || '');
  }

  if (!rows.length) throw new Error('Không có items. Nhập SubID list hoặc kết nối port Items.');

  // Mỗi row → [formatted_name] hoặc [variant1, variant2, ...]
  const optionsPerRow = rows.map(r =>
    r.variants.length > 0
      ? r.variants.map(v => formatName(v))
      : [formatName(r.text)]
  ).filter(opts => opts.some(Boolean));

  if (!optionsPerRow.length) throw new Error('Tất cả items đều rỗng sau khi format.');

  const combos = cartesianProduct(optionsPerRow);
  const names = combos.map(c => c.join('_')).filter(Boolean);

  context.log(`Sinh được ${names.length} tên`);

  const paths = [];

  if (config?.create_folders) {
    const basePath = (config?.base_path || '').trim();
    if (!basePath) throw new Error('Vui lòng nhập thư mục gốc (base_path).');
    if (!fs.existsSync(basePath)) throw new Error(`Thư mục gốc không tồn tại: ${basePath}`);

    const parsed = parseTemplate(config?.template || '');

    for (const name of names) {
      const fullPath = path.join(basePath, name);
      if (parsed.length > 0) {
        for (const { folder, subfolders } of parsed) {
          const folderPath = path.join(fullPath, folder);
          fs.mkdirSync(folderPath, { recursive: true });
          for (const sub of subfolders) {
            fs.mkdirSync(path.join(folderPath, sub), { recursive: true });
          }
        }
      } else {
        fs.mkdirSync(fullPath, { recursive: true });
      }
      paths.push(fullPath);
    }

    context.log(`Đã tạo ${paths.length} cấu trúc thư mục`);
  }

  return { names, paths };
};
