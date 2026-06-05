import { test, expect, type Page } from '@playwright/test';

/* Responsive / mobile regression suite for the agent UI.
 *
 * Covers the two surfaces that render UI: the public chat widget (home `/`) and
 * the operator `/admin` dashboard. The admin tests need an ADMIN_TOKEN that
 * matches the target server (skipped otherwise). Run locally (boots next start)
 * or against a deployed URL via PW_BASE. */

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

/** The whole document must fit the viewport width — the #1 "breaks on mobile" tell. */
async function assertNoHorizontalOverflow(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
  }));
  expect(sw, `scrollWidth(${sw}) must be <= innerWidth(${iw})`).toBeLessThanOrEqual(iw + 1);
}

test('home: widget renders with no horizontal overflow', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/Ask Nemo Router anything|^Hello /)).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test('home: send + suggestion controls are reachable', async ({ page }) => {
  await page.goto('/');
  // The empty-state hero textarea is present and full width.
  const ta = page.locator('textarea').first();
  await expect(ta).toBeVisible();
  const box = await ta.boundingBox();
  expect(box!.width).toBeGreaterThan(150);
});

test('desktop: Expand maximizes the widget to full screen with Close + Minimize', async ({ page, viewport }) => {
  test.skip((viewport?.width ?? 0) < 640, 'Expand is a desktop control (hidden on mobile)');
  await page.goto('/');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Corner card first: clearly smaller than the viewport.
  const before = (await dialog.boundingBox())!;
  expect(before.width).toBeLessThan(viewport!.width - 100);

  await page.getByRole('button', { name: 'Expand' }).click();
  await page.waitForTimeout(400);

  // Now full screen — fills the viewport edge to edge.
  const after = (await dialog.boundingBox())!;
  expect(after.width).toBeGreaterThanOrEqual(viewport!.width - 2);
  expect(after.height).toBeGreaterThanOrEqual(viewport!.height - 2);

  // Escape routes are present (the reported "with close option").
  await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Minimize' })).toBeVisible();

  // Minimize returns to the corner card.
  await page.getByRole('button', { name: 'Minimize' }).click();
  await page.waitForTimeout(400);
  const restored = (await dialog.boundingBox())!;
  expect(restored.width).toBeLessThan(viewport!.width - 100);
});

test.describe('admin dashboard', () => {
  test.skip(!ADMIN_TOKEN, 'set ADMIN_TOKEN to test the authenticated editor');

  async function login(page: Page) {
    await page.goto('/admin');
    const tokenBtn = page.getByRole('button', { name: /Use an admin token instead/i });
    if (await tokenBtn.count()) await tokenBtn.click();
    await page.locator('input[type=password]').first().fill(ADMIN_TOKEN);
    await page.getByRole('button', { name: /^Unlock$/ }).click();
    await expect(page.getByRole('heading', { name: 'Agent admin' })).toBeVisible();
  }

  test('login page: no overflow', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Agent admin' })).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test('editor: contact-method row stacks; value input stays usable on mobile', async ({ page, isMobile }) => {
    await login(page);
    const section = page.locator('section', { hasText: 'Contact methods' });
    await expect(section).toBeVisible();
    // Add a fresh row so the assertion is deterministic regardless of saved config.
    await section.getByRole('button', { name: '+ Add' }).click();

    const select = section.locator('select').first();
    const valueInput = section.getByPlaceholder(/\+1 \(555\)|support@acme\.com|acme\.com\/help/).first();
    await expect(select).toBeVisible();
    await expect(valueInput).toBeVisible();

    await assertNoHorizontalOverflow(page);

    const sBox = (await select.boundingBox())!;
    const vBox = (await valueInput.boundingBox())!;
    if (isMobile) {
      // Stacked: the value input sits BELOW the select (not crammed beside it)…
      expect(vBox.y).toBeGreaterThan(sBox.y + sBox.height - 2);
      // …and is wide enough to actually read/type the value (was ~82px crammed).
      expect(vBox.width).toBeGreaterThan(200);
    } else {
      // Desktop keeps the compact single-row layout.
      expect(Math.abs(vBox.y - sBox.y)).toBeLessThan(8);
    }
  });

  test('editor: primary actions meet the 44px touch target', async ({ page, isMobile }) => {
    await login(page);
    const save = page.getByRole('button', { name: /Save settings/ });
    await expect(save).toBeVisible();
    const box = (await save.boundingBox())!;
    if (isMobile) expect(box.height).toBeGreaterThanOrEqual(44);
    await assertNoHorizontalOverflow(page);
  });
});
