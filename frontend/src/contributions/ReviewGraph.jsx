import { useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, Handle, Position } from '@xyflow/react';
import { Check, LoaderCircle, Pause, Circle, ShieldCheck, FileText, UserRound, Code2, FlaskConical, ScanEye, GitPullRequest, Rocket } from 'lucide-react';
const icons = { assistant: FileText, manager: UserRound, code: Code2, security: ShieldCheck, specialist: ScanEye, tester: FlaskConical, reporter: FileText,
  source: GitPullRequest, owner: UserRound, release: Rocket };
export const statusText = { submitted: 'Mới gửi', queued: 'Chờ máy', running: 'Đang xử lý', waiting: 'Cần kiểm tra', reviewed: 'Chờ owner', changes_requested: 'Cần sửa',
  completed: 'Hoàn tất', failed: 'Lỗi', unknown: 'Chưa xác định', cancelled: 'Đã dừng', released: 'Đã phát hành', rejected: 'Đã từ chối', idle: 'Sẵn sàng', stopped: 'Đã tắt',
  passed: 'Đạt', pending: 'Chưa chạy', preparing: 'Đang chuẩn bị', ready: 'Sẵn sàng', accepted: 'Đã nghiệm thu', deploying: 'Đang áp dụng', rolled_back: 'Đã khôi phục' };
export function Status({ value }) { return <span className={`review-status review-status-${value || 'pending'}`}><i />{statusText[value] || value || 'Chưa chạy'}</span>; }
function RoleNode({ data, selected }) {
  const Icon = icons[data.role] || Circle; const StateIcon = data.status === 'completed' ? Check : data.status === 'running' ? LoaderCircle : data.status === 'waiting' ? Pause : Circle;
  return <div className={`review-role ${selected ? 'is-selected' : ''} is-${data.status}`}>
    <Handle type="target" position={Position.Top} />
    <div className="review-role-top"><span className="review-role-icon"><Icon size={17} /></span><StateIcon size={14} className={data.status === 'running' ? 'review-spin' : ''} /></div>
    <strong>{data.label}</strong><span className="review-role-model">{data.model || data.caption || 'Chờ phân công'}</span>
    <Status value={data.status} /><Handle type="source" position={Position.Bottom} />
  </div>;
}
const nodeTypes = { role: RoleNode };
export default function ReviewGraph({ job, selectedRole, onSelect }) {
  const container = useRef(null); const [viewport, setViewport] = useState({ x: 20, y: 20, zoom: 0.5 });
  const { nodes, edges } = useMemo(() => {
    if (!job) return { nodes: [], edges: [] };
    const tasks = job.tasks || [];
    const positions = { source: [0, 0], assistant: [220, 0], manager: [440, 0], code: [0, 170], security: [220, 170], specialist: [440, 170],
      tester: [0, 340], reporter: [220, 340], owner: [440, 340], release: [660, 340] };
    const data = [{ id: 'source', role: 'source', label: job.kind === 'pull_request' ? `Pull request #${job.source?.number}` : 'Đề xuất',
      status: 'completed', caption: `Revision ${job.revision}` }, ...tasks.map(task => ({ ...task, model: task.selection?.model })),
    { id: 'owner', role: 'owner', label: 'Bạn nghiệm thu & duyệt', status: job.approval ? 'completed' : 'pending', caption: job.trial?.result === 'accepted' ? 'Đã nghiệm thu candidate' : 'Xem báo cáo và dùng thử' },
    { id: 'release', role: 'release', label: 'Áp dụng & kiểm tra', status: job.release?.status === 'released' ? 'completed' : job.release?.status || 'pending', caption: 'Đúng candidate đã duyệt' }];
    const nodes = data.map(item => ({ id: item.id, type: 'role', position: { x: positions[item.id]?.[0] || 0, y: positions[item.id]?.[1] || 0 },
      data: item, width: 185, height: 135, selected: item.id === selectedRole, draggable: false }));
    const pairs = [['source', tasks.length ? 'assistant' : 'owner'], ['assistant', 'manager'], ['manager', 'code'], ['manager', 'security'],
      ...(tasks.some(task => task.id === 'specialist') ? [['manager', 'specialist'], ['specialist', 'tester']] : []),
      ['code', 'tester'], ['security', 'tester'], ['tester', 'reporter'], ['reporter', 'owner'], ['owner', 'release']];
    const ids = new Set(nodes.map(node => node.id));
    const edges = pairs.filter(([source, target]) => ids.has(source) && ids.has(target)).map(([source, target]) => ({ id: `${source}-${target}`, source, target,
      type: 'smoothstep', animated: data.find(item => item.id === target)?.status === 'running', style: { stroke: 'var(--n300, #c4c4cb)', strokeWidth: 1.5 } }));
    return { nodes, edges };
  }, [job, selectedRole]);
  useEffect(() => {
    const fit = () => {
      if (!container.current || !nodes.length) return;
      const { width, height } = container.current.getBoundingClientRect();
      const graphWidth = Math.max(...nodes.map(node => node.position.x)) + 185;
      const graphHeight = Math.max(...nodes.map(node => node.position.y)) + 135;
      const zoom = Math.max(0.3, Math.min(1.1, (width - 48) / graphWidth, (height - 48) / graphHeight));
      setViewport({ x: (width - graphWidth * zoom) / 2, y: (height - graphHeight * zoom) / 2, zoom });
    };
    const observer = new ResizeObserver(fit); if (container.current) observer.observe(container.current); fit();
    return () => observer.disconnect();
  }, [job?.id, nodes.length, selectedRole]);
  return <div ref={container} style={{ width: '100%', height: '100%' }}><ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodeClick={(_, node) => onSelect(node.id)} viewport={viewport} onViewportChange={setViewport}
    minZoom={0.3} maxZoom={1.4} nodesConnectable={false} elementsSelectable proOptions={{ hideAttribution: true }} aria-label="Luồng đánh giá đề xuất">
    <Background gap={22} size={1} color="var(--n200, #e4e4e7)" /><Controls showInteractive={false} />
  </ReactFlow></div>;
}
