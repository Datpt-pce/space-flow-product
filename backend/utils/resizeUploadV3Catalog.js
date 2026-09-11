const db = require('../db');
const templates = require('../../nodes/resize-upload-v3/app-library.json');

function mergeCatalog(...layers) {
  const merged = {};
  for (const layer of layers) for (const [id, app] of Object.entries(layer || {})) {
    if (app === null) { delete merged[id]; continue; }
    const previous = merged[id] || { platforms: {} };
    const platforms = { ...previous.platforms };
    for (const [key, platform] of Object.entries(app.platforms || {})) {
      if (platform === null) delete platforms[key];
      else platforms[key] = { ...platforms[key], ...platform };
    }
    merged[id] = { ...previous, ...app, platforms };
  }
  return merged;
}

function validateCatalog(data, allowDeletedApps = false) {
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const key = value => /^[a-z0-9][a-z0-9-]{0,79}$/.test(value) && !['constructor', 'prototype'].includes(value);
  if (!object(data) || Object.keys(data).length > 300) throw new Error('Thư viện App không hợp lệ');
  for (const [id, app] of Object.entries(data)) {
    if (key(id) && app === null && allowDeletedApps) continue;
    if (!key(id) || !object(app) || !object(app.platforms)) throw new Error('App cần id và danh sách nền tảng hợp lệ');
    if (typeof app.name !== 'string' || !app.name.trim() || app.name.length > 120) throw new Error('Tên App không hợp lệ');
    if (Object.keys(app.platforms).length > 30) throw new Error('Quá nhiều nền tảng');
    for (const [platformId, platform] of Object.entries(app.platforms)) {
      if (!key(platformId)) throw new Error('Nền tảng không hợp lệ');
      if (platform === null) continue;
      if (!object(platform)) throw new Error('Nền tảng không hợp lệ');
      for (const [field, value] of Object.entries(platform)) {
        if (!['name', 'code', 'folder', 'thumbnail_folder'].includes(field) || typeof value !== 'string' || value.length > 2048) throw new Error('Trường nền tảng không hợp lệ');
      }
      if (platform.code && !/^[A-Za-z0-9-]{1,40}$/.test(platform.code)) throw new Error('Mã app chỉ gồm chữ, số và dấu gạch ngang');
      for (const field of ['folder', 'thumbnail_folder']) {
        if (platform[field] && (/^https?:\/\//i.test(platform[field]) || /[\x00-\x1f]/.test(platform[field]))) {
          throw new Error('Dùng đường dẫn thư mục Google Drive đã đồng bộ trên máy, không dùng URL web');
        }
      }
    }
  }
  return data;
}

function read(scope, ownerId = '') {
  const row = db.prepare('SELECT data FROM resize_v3_catalogs WHERE scope = ? AND owner_id = ?').get(scope, ownerId);
  return row ? JSON.parse(row.data) : null;
}

function getCatalogs(userId) {
  const publicOverrides = read('public') || {};
  const publicCatalog = mergeCatalog(templates, publicOverrides);
  const mine = userId ? read('private', userId) : null;
  return { public: publicCatalog, public_overrides: publicOverrides, mine, effective: mergeCatalog(publicCatalog, mine) };
}

function saveCatalog(scope, userId, data) {
  if (!['public', 'private'].includes(scope) || !userId) throw new Error('Phạm vi thư viện không hợp lệ');
  validateCatalog(data, scope === 'public');
  db.prepare(`INSERT INTO resize_v3_catalogs(scope, owner_id, data) VALUES (?, ?, ?)
    ON CONFLICT(scope, owner_id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`)
    .run(scope, scope === 'public' ? '' : userId, JSON.stringify(data));
}

function deletePrivateCatalog(userId) {
  db.prepare("DELETE FROM resize_v3_catalogs WHERE scope = 'private' AND owner_id = ?").run(userId);
}

module.exports = { mergeCatalog, validateCatalog, getCatalogs, saveCatalog, deletePrivateCatalog };
