const { expect } = require('@playwright/test');


async function waitForDialogPanelSettled(panel) {
  await expect(panel).toBeVisible();
  await expect.poll(async () => panel.evaluate((element) => {
    const style = getComputedStyle(element);
    const matrix = style.transform === 'none'
      ? new DOMMatrixReadOnly()
      : new DOMMatrixReadOnly(style.transform);
    const opacity = Number.parseFloat(style.opacity);
    const scaleX = Math.hypot(matrix.m11, matrix.m12);
    const scaleY = Math.hypot(matrix.m21, matrix.m22);

    return Number.isFinite(opacity)
      && opacity >= 0.999
      && Math.abs(matrix.m41) <= 0.1
      && Math.abs(matrix.m42) <= 0.1
      && Math.abs(scaleX - 1) <= 0.001
      && Math.abs(scaleY - 1) <= 0.001;
  }), {
    message: 'dialog panel should finish its entrance before final geometry assertions',
  }).toBe(true);
}


async function waitForVisibleDialogPanelsSettled(page) {
  const panels = page.locator('dialog[open] [data-dialog-panel]:visible');
  const count = await panels.count();
  for (let index = 0; index < count; index += 1) {
    await waitForDialogPanelSettled(panels.nth(index));
  }
}


module.exports = {
  waitForDialogPanelSettled,
  waitForVisibleDialogPanelsSettled,
};
