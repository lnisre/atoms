import { expect, test, type Page } from '@playwright/test';
import { snapshot } from '../team/cross-app-workflow';

// Requires the real gateway/runner with tests/team/fixture_transport.py replacing
// the provider. No HTTP/WebSocket route interception and no storage writes.
test.describe('stopping a native task leaves no stream errors or late results', () => {
  test.skip(process.env.TEAM_FIXTURE !== '1', 'Explicit offline provider required');
  test.setTimeout(120000);

  function observe(page: Page) {
    const errors: string[] = [];
    const sockets: { reviews: number; artifacts: number; closed: boolean; framesAfterClose: number }[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('websocket', ws => {
      if (!ws.url().endsWith('/api/team/socket')) return;
      const state = { reviews: 0, artifacts: 0, closed: false, framesAfterClose: 0 };
      sockets.push(state);
      ws.on('framereceived', frame => {
        if (state.closed) state.framesAfterClose++;
        const m = JSON.parse(String(frame.payload));
        if (m.type === 'call' && m.call.actor === 'Reviewer' && m.call.status === 'started') state.reviews++;
        if (m.type === 'artifact') state.artifacts++;
      });
      ws.on('close', () => { state.closed = true; });
    });
    return { errors, sockets };
  }

  test('first generation stops after a cached artifact without publishing it', async ({ page }, info) => {
    const observations = observe(page);
    await page.goto('/');
    await expect(page.getByRole('region', { name: '已有项目' }).getByRole('button', { name: /示例 · 专注番茄钟/ })).toBeVisible();
    const before = await snapshot(page);
    await page.getByLabel('你想做什么？').fill('一次修复 停止返工');
    await page.getByRole('button', { name: '开始生成' }).click();
    await expect.poll(() => observations.sockets[0]?.reviews, { timeout: 65000 }).toBe(2);
    expect(observations.sockets[0].artifacts).toBeGreaterThan(0);
    await page.getByRole('button', { name: '停止任务', exact: true }).click();
    await expect(page.getByRole('heading', { name: '任务已停止' })).toBeVisible();
    await expect.poll(() => observations.sockets[0].closed).toBe(true);
    await expect(page.getByRole('button', { name: '停止任务' })).toHaveCount(0);
    // Observe beyond the fixture's 30-second delayed Reviewer response.
    await page.waitForTimeout(32000);
    await expect(page.locator('iframe')).toHaveCount(0);
    expect(await snapshot(page)).toEqual(before);
    expect(observations.sockets[0].framesAfterClose).toBe(0);
    expect(observations.errors).toEqual([]);
    await page.screenshot({ path: info.outputPath('first-stopped.png') });
    await page.reload();
    expect(await snapshot(page)).toEqual(before);
    expect(observations.sockets).toHaveLength(1);
    expect(observations.errors).toEqual([]);
    await info.attach('stop-evidence', { body: JSON.stringify({ before, after: await snapshot(page), ...observations, observationMs: 32000 }), contentType: 'application/json' });
  });

  test('modification stop preserves adopted code, business data and modification records', async ({ page }, info) => {
    const observations = observe(page);
    await page.goto('/');
    await page.getByLabel('你想做什么？').fill('受控计数器');
    await page.getByRole('button', { name: '开始生成' }).click();
    await expect(page.getByText('项目已保存', { exact: true })).toBeVisible({ timeout: 65000 });
    const modify = async (requirement: string) => {
      await page.getByLabel('追加修改需求').fill(requirement);
      await page.getByRole('button', { name: '生成候选', exact: true }).click();
    };
    await modify('保留计数操作与保存');
    await expect(page.getByText('第 1 轮候选 · 等待采用', { exact: true })).toBeVisible({ timeout: 65000 });
    await page.getByRole('button', { name: '采用修改', exact: true }).click();
    await expect(page.getByText('运行预览 · 已采用应用')).toBeVisible();
    await page.frameLocator('iframe').getByRole('button', { name: '增加', exact: true }).click();
    await expect(page.frameLocator('iframe').locator('output')).toHaveText('1');
    await expect(page.getByText('应用数据已保存', { exact: true })).toBeVisible();
    await expect(page.getByText('执行记录正在保存，请等待完成再离开。')).toHaveCount(0);
    const before = await snapshot(page), projectId = new URL(page.url()).searchParams.get('project');
    const project = before.projects.find(row => row.id === projectId)!;
    expect(project.modificationRecords).toHaveLength(1);
    expect(before.data.find(row => row.projectId === projectId)?.state).toEqual({ count: 1 });
    const source = await page.locator('iframe').getAttribute('srcdoc');
    await modify('一次修复 停止返工');
    await expect.poll(() => observations.sockets[2]?.reviews, { timeout: 65000 }).toBe(2);
    expect(observations.sockets[2].artifacts).toBeGreaterThan(0);
    await page.getByRole('button', { name: '停止任务', exact: true }).click();
    await expect(page.getByRole('button', { name: '生成候选', exact: true })).toBeEnabled();
    await expect.poll(() => observations.sockets[2].closed).toBe(true);
    await page.waitForTimeout(32000);
    expect(await page.locator('iframe').getAttribute('srcdoc')).toBe(source);
    await expect(page.getByRole('button', { name: '采用修改', exact: true })).toHaveCount(0);
    const after = await snapshot(page);
    expect(after).toEqual(before);
    expect(observations.sockets[2].framesAfterClose).toBe(0);
    expect(observations.errors).toEqual([]);
    await page.screenshot({ path: info.outputPath('modification-stopped.png') });
    await page.reload();
    await expect(page.frameLocator('iframe').locator('output')).toHaveText('1');
    expect(await snapshot(page)).toEqual(before);
    expect(observations.sockets).toHaveLength(3);
    expect(observations.errors).toEqual([]);
    await info.attach('stop-evidence', { body: JSON.stringify({ before, after, ...observations, observationMs: 32000 }), contentType: 'application/json' });
  });
});
