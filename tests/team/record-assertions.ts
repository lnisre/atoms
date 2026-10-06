import { expect, type FrameLocator, type Page } from '@playwright/test';

// Empty-state li elements are not records. Check names independently so removing
// data-id cannot hide a still-visible business record from the assertion.
export async function expectVisibleRecords(scope: FrameLocator | Page, names: string[], ids?: string[]) {
  const rows = scope.locator('#records li[data-id]:visible');
  await expect(scope.locator('#records .title:visible')).toHaveText(names);
  await expect(rows).toHaveCount(names.length);
  await expect(rows.locator('.title:visible')).toHaveText(names);
  await expect(scope.locator('#records li:not([data-id]) .title:visible')).toHaveCount(0);
  const actualIds = await rows.evaluateAll(elements => elements.map(el => el.getAttribute('data-id')));
  expect(actualIds.every(id => typeof id === 'string' && id.length > 0), 'every record has an identity').toBe(true);
  expect(new Set(actualIds).size, 'record identities are unique').toBe(actualIds.length);
  if (ids) expect(actualIds, 'visible record identities').toEqual(ids);
}
