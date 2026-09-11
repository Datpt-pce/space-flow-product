import { useState, useRef, useEffect } from 'react';

// NodeToolbar của react-flow (và các rail nổi tương tự) render tách khỏi DOM subtree của node
// (portal, hoặc chỉ đặt cạnh bằng absolute positioning) — 1 cặp onMouseEnter/onMouseLeave đặt
// thẳng trên wrapper sẽ "nhấp nháy" mất trạng thái hover ngay khi di chuột từ card sang phần nổi
// đó (khoảng cách offset không thuộc DOM subtree nào cả). Dùng grace-period nhỏ (huỷ timeout nếu
// enter lại trước khi hết hạn) + gắn cùng handler cho CẢ 2 vùng tách rời để coi là "đang hover".
// Trích từ BaseNodeBeta.jsx (dùng chung với ListNodeBeta.jsx — xem instruction.md mục "chưa làm
// — cố tình hoãn": đồng bộ hover-reveal của toolbar/resize giữa 2 file).
export function useHoverGrace(delayMs = 150) {
  const [hovered, setHovered] = useState(false);
  const timerRef = useRef(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  const onMouseEnter = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setHovered(true);
  };
  const onMouseLeave = () => {
    timerRef.current = setTimeout(() => setHovered(false), delayMs);
  };
  return [hovered, { onMouseEnter, onMouseLeave }];
}
