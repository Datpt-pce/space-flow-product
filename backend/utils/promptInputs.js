// 1 input port có thể nhận nhiều edge (nhiều node Text nối vào chung 1 dot) — engine
// gộp thành mảng, 1 edge vẫn ra giá trị đơn (backend/engine/executor.js dòng gộp multi-edge).
function toTextArray(value) {
  return Array.isArray(value) ? value : (value !== undefined ? [value] : []);
}

module.exports = { toTextArray };
