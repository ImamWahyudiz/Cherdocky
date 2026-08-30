import { test, expect } from '@playwright/test';

test('ONNX engine selectable via URL param', async ({ page }) => {
  await page.goto('/test/eval/runner.html?engine=onnx');
  await page.waitForFunction(
    () => typeof (window as any).runEval === 'function',
    null,
    { timeout: 120_000 }
  );
  await page.waitForFunction(() => (window as any).__OCR_ENGINE, null, {
    timeout: 30_000,
  });
  const activeEngine = await page.evaluate(
    () => (window as any).__OCR_ENGINE
  );
  expect(activeEngine).toBe('onnx');
});

test('Tesseract engine selectable via URL param', async ({ page }) => {
  await page.goto('/test/eval/runner.html?engine=tesseract');
  await page.waitForFunction(
    () => typeof (window as any).runEval === 'function',
    null,
    { timeout: 120_000 }
  );
  await page.waitForFunction(() => (window as any).__OCR_ENGINE, null, {
    timeout: 30_000,
  });
  const activeEngine = await page.evaluate(
    () => (window as any).__OCR_ENGINE
  );
  expect(activeEngine).toBe('tesseract');
});

export { };