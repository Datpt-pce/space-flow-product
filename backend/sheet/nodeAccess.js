var d=Object.defineProperty;var n=(r,e)=>d(r,"name",{value:e,configurable:!0});const crypto=require("crypto"),db=require("../db");function loadSheetForNode(r,e,{write:i=!1}={}){if(!r)throw new Error("Thi\u1EBFu config.sheetId");const t=db.prepare("SELECT * FROM sheets WHERE id = ?").get(r);if(!t)throw new Error(`Kh\xF4ng t\xECm th\u1EA5y sheet "${r}"`);if(i){if(t.owner_id!==e)throw new Error("Ch\u1EC9 ch\u1EE7 s\u1EDF h\u1EEFu m\u1EDBi ghi \u0111\u01B0\u1EE3c v\xE0o sheet n\xE0y")}else if(t.visibility==="private"&&t.owner_id!==e)throw new Error("Sheet n\xE0y l\xE0 ri\xEAng t\u01B0 c\u1EE7a ng\u01B0\u1EDDi kh\xE1c");return t}n(loadSheetForNode,"loadSheetForNode");function getTab(r,e){const i=r.sheets?.[e];if(!i)throw new Error(`Kh\xF4ng t\xECm th\u1EA5y tab "${e}" trong sheet`);return i}n(getTab,"getTab");function upsertBinding(r,e,i,t,o){const h=db.prepare(`
    SELECT id FROM sheet_port_bindings
    WHERE sheet_id = ? AND tab_id = ? AND range_a1 = ? AND direction = ? AND workflow_node_id = ?
  `).get(r,e,i,t,o);if(h)return h.id;const s=crypto.randomUUID();return db.prepare(`
    INSERT INTO sheet_port_bindings (id, sheet_id, tab_id, range_a1, direction, workflow_node_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(s,r,e,i,t,o),s}n(upsertBinding,"upsertBinding"),module.exports={loadSheetForNode,getTab,upsertBinding};
