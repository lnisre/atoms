import { test, expect, type Locator } from '@playwright/test';
import { fixture, generate, frame, ready, modify } from '../helpers/cloud-browser-fixture';

// Auth, BFF and generated code are synthetic; interaction, layout and iframe are real.
async function hitTarget(button: Locator) {
  await expect(button).toBeInViewport({ ratio: 1 });
  expect(await button.evaluate(el => {
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit === el || el.contains(hit);
  })).toBe(true);
}

test('secondary actions have visible button boundaries and spaced history targets', async ({ page, context }, info) => {
  const store = await fixture(); await store.connect(context); await generate(page); await expect(ready(page)).toBeVisible();
  for (const name of ['我的项目', '历史保存点', '重新载入云端版本']) {
    const button = page.getByRole('button', { name, exact: true });
    await expect(button).toHaveCSS('border-top-width', '1px');
    await hitTarget(button);
  }
  await modify(page); await page.getByRole('button', { name: '采用修改', exact: true }).click();
  await expect(page.getByRole('button', { name: '采用修改', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '历史保存点', exact: true }).click();
  const actions = ['恢复到 V1', '清理 V1 保存点', '试用 V1 副本'].map(name => page.getByRole('button', { name, exact: true }));
  for (const button of actions) { await button.scrollIntoViewIfNeeded(); await hitTarget(button); }
  const boxes = await Promise.all(actions.map(b => b.boundingBox()));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i]!, b = boxes[j]!;
    expect(a.x + a.width + 7 <= b.x || b.x + b.width + 7 <= a.x || a.y + a.height + 7 <= b.y || b.y + b.height + 7 <= a.y).toBe(true);
  }
  await page.screenshot({ path: info.outputPath('history-buttons.png') });
  await page.getByRole('button', { name: '刷新历史列表', exact: true }).click();
  await expect(page.getByRole('button', { name: '刷新历史列表', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '返回当前项目', exact: true }).click();
  await page.getByRole('button', { name: '重新载入云端版本', exact: true }).click();
  await expect(frame(page).getByRole('heading', { name: 'Counter 2' })).toBeVisible();
  await page.getByRole('button', { name: '我的项目', exact: true }).click();
  await expect(page.getByRole('heading', { name: '我的项目', exact: true })).toBeVisible();
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 480 }, { width: 390, height: 640 }]) {
  test(`restore confirmation stays reachable at ${viewport.width}x${viewport.height} and restores paired V1`, async ({ page, context }, info) => {
    const store = await fixture(); await store.connect(context); await generate(page); await expect(ready(page)).toBeVisible();
    const increment = frame(page).getByRole('button', { name: '增加', exact: true });
    await expect.poll(async () => { await increment.hover(); return increment.evaluate(el => el.matches(':hover')); }).toBe(true);
    await increment.click(); await expect(page.getByText('应用数据已保存到云端', { exact: true })).toBeVisible();
    for (let i = 0; i < 2; i++) { await modify(page); await page.getByRole('button', { name: '采用修改', exact: true }).click(); await expect(page.getByRole('button', { name: '采用修改', exact: true })).toHaveCount(0); }
    const id = [...store.rows.keys()][0], before = structuredClone(store.rows.get(id)!.cloud), calls = store.calls();
    // Long user-authored summary at the existing history response seam.
    store.histories.get(id)![0].entry.summary = '做一个小费计算器，可以输入账单金额、小费比例和人数，显示每人应付金额。'.repeat(12);
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: '历史保存点', exact: true }).click();
    const trigger = page.getByRole('button', { name: '恢复到 V1', exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: '确认恢复到 V1', exact: true });
    const confirm = dialog.getByRole('button', { name: '确认恢复', exact: true });
    const cancel = dialog.getByRole('button', { name: '取消', exact: true });
    await page.screenshot({ path: info.outputPath('restore-confirmation.png') });
    await hitTarget(confirm); await hitTarget(cancel);
    await expect(cancel).toBeFocused();
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
    expect(store.rows.get(id)!.cloud).toEqual(before);
    await trigger.click(); await cancel.click(); await expect(dialog).toHaveCount(0);
    await trigger.click(); await confirm.click();
    await expect(page.getByRole('button', { name: '撤销本次恢复', exact: true })).toBeEnabled();
    await expect(frame(page).getByRole('heading', { name: 'Counter 1' })).toBeVisible();
    await expect(frame(page).locator('#count')).toHaveText('1');
    expect(store.rows.get(id)!.cloud.project.modificationRecords).toHaveLength(0);
    expect(store.rows.get(id)!.cloud.state).toEqual({ count: 1 });
    await page.reload(); await expect(frame(page).getByRole('heading', { name: 'Counter 1' })).toBeVisible();
    await page.getByRole('button', { name: '撤销本次恢复', exact: true }).click();
    const undo = page.getByRole('button', { name: '确认撤销恢复', exact: true });
    await hitTarget(undo); await undo.click();
    await expect(frame(page).getByRole('heading', { name: 'Counter 3' })).toBeVisible();
    expect(store.rows.get(id)!.cloud.project.modificationRecords).toEqual(before.project.modificationRecords);
    expect(store.calls()).toBe(calls);
  });
}
