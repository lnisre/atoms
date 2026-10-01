import type { Command, Json, Scenario } from '../../src/lib/qa/contract';

// Frozen developer acceptance inputs. They are never a Reviewer tool plan.
export type AppKind = 'todo' | 'reading';
export function appContract(kind: AppKind) {
  const reading = kind === 'reading';
  return { kind, collection: reading ? 'books' : 'tasks', title: reading ? 'name' : 'title',
    state: reading ? 'status' : 'done', initial: reading ? 'reading' : false,
    complete: reading ? 'finished' : true };
}
export function syntheticRequirement(kind: AppKind) {
  const c = appContract(kind);
  return `做一个中文${kind === 'reading' ? '阅读记录' : '待办'}应用，支持添加名称、${kind === 'reading' ? '切换在读/已读' : '切换完成/未完成'}和删除。数据为 {${c.collection}:[{id:string,${c.title}:string,${c.state}:${kind === 'reading' ? '"reading"|"finished"' : 'boolean'}}]}，只在 null 时初始化。旧记录缺少${c.state}默认${JSON.stringify(c.initial)}。保留根对象和每条记录未知字段；加载时不自动保存。输入 id=name，添加按钮 id=add，列表 id=records，每行 li 的 data-id 等于记录 id，名称用 .title 显示，切换和删除按钮 class=toggle/remove。同浏览器保存恢复，读取失败禁编辑，保存失败完整回退。样式自行决定。`;
}
export const readingChanges = [
  '保留阅读记录全部功能和字段，为每条书增加 rating 整数评分0到5，旧记录缺失默认0。每行 select.score 提供0到5选项，改评分立即保存。新增状态筛选 select#filter，值 all/active/complete 分别显示全部/在读/已读，筛选仅影响显示，不持久化也不删除数据。保留未知字段。',
  '在最新候选基础上，把筛选框移到列表上方。保留评分、筛选、添加、状态切换、删除、原数据字段和缺省值行为，继续使用相同控件标识。',
];
export function syntheticSeed(kind: AppKind): Json {
  const c = appContract(kind);
  return { [c.collection]: [{ id: 'old', [c.title]: '旧记录', extra: { marker: 'INDEPENDENT_ONLY' } }], unknown: { marker: 'INDEPENDENT_ROOT' } };
}
export function acceptanceScenarios(kind: AppKind, rated = false): Scenario[] {
  const c = appContract(kind), seed = syntheticSeed(kind), status = '[data-atoms-status]';
  const until = (text: string): Command => ({ op: 'wait-for', selector: status, property: 'text', equals: text });
  const wait = until('已保存'), loaded = until('已读取');
  const check = (selector: string, property: 'text' | 'count' | 'inert' | 'value', equals: Json): Command => ({ op: 'assert', selector, property, equals });
  const data = (path: string[], equals: Json): Command => ({ op: 'data', path, equals });
  const bridge = (property: 'saveAttempts' | 'commits' | 'rejectedSaves', equals: number): Command => ({ op: 'bridge', property, equals });
  const click = (selector: string): Command => ({ op: 'click', selector });
  const input = (selector: string, value: string): Command => ({ op: 'input', selector, value });
  const scenario = (id: string, commands: Command[], extra = {}): Scenario => ({ id, seed, ...extra,
    checks: commands.map((command, i) => ({ id: `${id}-${i}`, label: `${id} ${i + 1}`, command })) });
  const preserved = [data(['unknown'], { marker: 'INDEPENDENT_ROOT' }), data([c.collection, '0', 'extra'], { marker: 'INDEPENDENT_ONLY' })];
  const normal: Command[] = [
    check('button:not(:disabled),input:not(:disabled),select:not(:disabled)', 'count', 0), bridge('saveAttempts', 0), loaded,
    check('#records li', 'count', 1), check('[data-id="old"] .title', 'text', '旧记录'), bridge('commits', 0),
    ...(rated ? [check('[data-id="old"] .score', 'value', '0')] : []),
    input('#name', '独立新增'), click('#add'), check('body', 'inert', true), check(status, 'text', '正在保存'),
    { op: 'click', selector: '#add', probeWhileInert: true }, data([], seed), wait,
    check(status, 'text', '已保存'), check('body', 'inert', false), data([c.collection, 'length'], 2),
    data([c.collection, '1', c.title], '独立新增'), ...preserved, bridge('saveAttempts', 1), bridge('commits', 1),
    click('[data-id="old"] .toggle'), wait, data([c.collection, '0', c.state], c.complete), ...preserved,
    ...(rated ? [input('[data-id="old"] .score', '4'), wait, data([c.collection, '0', 'rating'], 4),
      input('#filter', 'active'), check('#records li', 'count', 1), check('#records li .title', 'text', '独立新增'),
      input('#filter', 'complete'), check('#records li', 'count', 1), check('#records li .title', 'text', '旧记录'),
      input('#filter', 'all'), check('#records li', 'count', 2)] : []),
    click('#records li:last-child .remove'), wait, data([c.collection, 'length'], 1), ...preserved,
    bridge('commits', rated ? 4 : 3),
  ];
  return [scenario('core-defaults-preservation-timing', normal, { loadDelayMs: 500, saveDelayMs: 500 }),
    scenario('read-failure', [until('读取失败'), check(status, 'text', '读取失败'), check('button:not(:disabled),input:not(:disabled),select:not(:disabled)', 'count', 0), bridge('saveAttempts', 0), bridge('commits', 0), data([], seed)], { fault: 'read' }),
    scenario('save-failure', [loaded, input('#name', '失败新增'), click('#add'), check('body', 'inert', true), until('保存失败'),
      check(status, 'text', '保存失败'), check('#records li', 'count', 1), data([], seed), bridge('saveAttempts', 1), bridge('rejectedSaves', 1), bridge('commits', 0)], { fault: 'save', saveDelayMs: 500 })];
}
