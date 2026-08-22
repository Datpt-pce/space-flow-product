import BaseNodeLTS from '../nodes/BaseNodeLTS.jsx';
import BaseNodeBeta from '../nodes/BaseNodeBeta.jsx';
import ListNode from '../nodes/ListNode.jsx';
import ListNodeBeta from '../nodes/ListNodeBeta.jsx';
import TextNode from '../nodes/TextNode.jsx';
import MediaNode from '../nodes/MediaNode.jsx';
import StickyNoteNode from '../nodes/StickyNoteNode.jsx';
import ImageBatchResizeNode from '../nodes/ImageBatchResizeNode.jsx';
import VideoDownloaderNode from '../nodes/VideoDownloaderNode.jsx';
import BatchCreateFolderNode from '../nodes/BatchCreateFolderNode.jsx';
import ListContentNode from '../nodes/ListContentNode.jsx';
import ListAllNode from '../nodes/ListAllNode.jsx';
import AdvancedRenamerNode from '../nodes/AdvancedRenamerNode.jsx';
import CapcutGenerateNode from '../nodes/CapcutGenerateNode.jsx';
import ResizeUploadNode from '../nodes/ResizeUploadNode.jsx';
import ResizeUploadV2Node from '../nodes/ResizeUploadV2Node.jsx';
import ScheduleTriggerNode from '../nodes/ScheduleTriggerNode.jsx';
import ChatTriggerNode from '../nodes/ChatTriggerNode.jsx';

const CUSTOM_NODES = { list: ListNode, text: TextNode, media: MediaNode, 'sticky-note': StickyNoteNode, 'image-batch-resize': ImageBatchResizeNode, 'video-downloader': VideoDownloaderNode, 'batch-create-folder': BatchCreateFolderNode, 'list-content': ListContentNode, 'list-all': ListAllNode, 'advanced-renamer': AdvancedRenamerNode, 'capcut-generate': CapcutGenerateNode, 'resize-upload': ResizeUploadNode, 'resize-upload-v2': ResizeUploadV2Node, 'schedule-trigger': ScheduleTriggerNode, 'chat-trigger': ChatTriggerNode };

// designMode !== 'beta' (mặc định 'lts') giữ nguyên y hệt hành vi hôm nay — chỉ node có bản Beta
// riêng (hiện chỉ 'list') mới đổi component khi designMode==='beta'; các node đặc thù khác vẫn
// dùng bản LTS của chúng cho tới khi có ListNodeBeta-tương-đương riêng.
const BETA_NODES = { list: ListNodeBeta };

// All custom node types registered here
// When adding a new node: import its component and add to CUSTOM_NODES above
export function buildNodeTypes(manifests, designMode = 'lts') {
  const fallback = designMode === 'beta' ? BaseNodeBeta : BaseNodeLTS;
  const types = {};
  for (const m of manifests) {
    types[m.id] = (designMode === 'beta' && BETA_NODES[m.id]) || CUSTOM_NODES[m.id] || fallback;
  }
  return types;
}

export const CATEGORY_COLORS = {
  trigger: '#eab308',
  input:   '#0ea5e9',
  image:   '#7c3aed',
  ai:      '#f59e0b',
  data:    '#10b981',
  output:  '#ef4444',
  control: '#6b7280',
};
