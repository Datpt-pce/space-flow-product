// Graph Library Phase 5 (specs/space-flow-master-plan/02-graph-library.md): pure-logic tests for
// queryEngine.js — no React/DOM needed. Run with: node frontend/src/graph/queryEngine.test.js

import assert from 'assert';
import { parseQuery, matchesQuery, isOrphan, resolveGroupColor } from './queryEngine.js';

let pass = 0;
let fail = 0;
function check(label, fn) {
  try {
    fn();
    pass++;
    console.log(`PASS — ${label}`);
  } catch (err) {
    fail++;
    console.error(`FAIL — ${label}: ${err.message}`);
  }
}

function main() {
  check('parseQuery: tách nhiều clause cách nhau bằng khoảng trắng', () => {
    const clauses = parseQuery('type:workflow owner:me');
    assert.deepStrictEqual(clauses, [
      { field: 'type', op: '=', value: 'workflow' },
      { field: 'owner', op: '=', value: 'me' },
    ]);
  });

  check('parseQuery: date clause tách đúng operator >, <, >=, <=', () => {
    assert.deepStrictEqual(parseQuery('date:>2026-01-01'), [{ field: 'date', op: '>', value: '2026-01-01' }]);
    assert.deepStrictEqual(parseQuery('date:>=2026-01-01'), [{ field: 'date', op: '>=', value: '2026-01-01' }]);
    assert.deepStrictEqual(parseQuery('date:<2026-01-01'), [{ field: 'date', op: '<', value: '2026-01-01' }]);
  });

  check('parseQuery: token không có ":" hoặc rỗng bị bỏ qua, không throw', () => {
    assert.deepStrictEqual(parseQuery('garbage type:workflow :novalue field:'), [
      { field: 'type', op: '=', value: 'workflow' },
    ]);
  });

  check('matchesQuery: rỗng luôn match mọi entity', () => {
    assert.strictEqual(matchesQuery({ type: 'workflow' }, ''), true);
  });

  check('matchesQuery: type: khớp đúng type, AND kết hợp nhiều clause', () => {
    const entity = { type: 'workflow', ownerId: 'u1' };
    assert.strictEqual(matchesQuery(entity, 'type:workflow owner:u1'), true);
    assert.strictEqual(matchesQuery(entity, 'type:workflow owner:u2'), false);
    assert.strictEqual(matchesQuery(entity, 'type:node_instance'), false);
  });

  check('matchesQuery: owner:me resolve qua ctx.currentUserId', () => {
    const entity = { ownerId: 'u1' };
    assert.strictEqual(matchesQuery(entity, 'owner:me', { currentUserId: 'u1' }), true);
    assert.strictEqual(matchesQuery(entity, 'owner:me', { currentUserId: 'u2' }), false);
  });

  check('matchesQuery: date:> / date:< so đúng theo mốc thời gian', () => {
    const entity = { updatedAt: '2026-06-15T00:00:00Z' };
    assert.strictEqual(matchesQuery(entity, 'date:>2026-01-01'), true);
    assert.strictEqual(matchesQuery(entity, 'date:<2026-01-01'), false);
    assert.strictEqual(matchesQuery(entity, 'date:>2027-01-01'), false);
  });

  check('matchesQuery: field lạ (tag:/status: chưa có nguồn dữ liệu) là no-op, không ẩn entity', () => {
    assert.strictEqual(matchesQuery({ type: 'workflow' }, 'tag:urgent'), true);
    assert.strictEqual(matchesQuery({ type: 'workflow' }, 'status:published'), true);
  });

  check('isOrphan: degree 0 hoặc thiếu field đều coi là orphan', () => {
    assert.strictEqual(isOrphan({ degree: 0 }), true);
    assert.strictEqual(isOrphan({}), true);
    assert.strictEqual(isOrphan({ degree: 3 }), false);
  });

  check('resolveGroupColor: group đầu tiên khớp thắng, không group nào khớp trả về null', () => {
    const entity = { type: 'workflow', ownerId: 'u1' };
    const groups = [
      { query: 'type:node_instance', color: 'red' },
      { query: 'owner:u1', color: 'blue' },
      { query: 'type:workflow', color: 'green' },
    ];
    assert.strictEqual(resolveGroupColor(entity, groups), 'blue');
    assert.strictEqual(resolveGroupColor(entity, [{ query: 'type:node_instance', color: 'red' }]), null);
  });

  console.log(`\n${pass}/${pass + fail} passed${fail ? `, ${fail} FAILED` : ''}`);
  if (fail) process.exitCode = 1;
}

main();
