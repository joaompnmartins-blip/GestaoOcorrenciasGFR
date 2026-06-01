'use strict';
const { test, expect } = require('@playwright/test');

async function login(page, email = 'gestor@test.pt', password = 'test123') {
  await page.goto('/');
  await page.fill('#auth-email', email);
  await page.fill('#auth-pass', password);
  await page.click('#auth-btn');
  await expect(page.locator('#auth-overlay')).toHaveClass(/hidden/, { timeout: 8000 });
}

async function criarOcorrencia(page) {
  await page.click('#btnNew');
  await page.locator('#modal-occ').waitFor({ state: 'visible' });
  await page.fill('#occ-nome', 'Ocorrência E2E Teste');
  await page.selectOption('#occ-subregiao', 'Alto Minho');
  await page.locator('#modal-occ button:has-text("Guardar")').click();
  // Esperar que a ocorrência apareça na lista e clicar para abrir detalhe
  await page.locator('.occ-card').first().waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('.occ-card').first().click();
  await expect(page.locator('#page-detalhe')).toBeVisible({ timeout: 5000 });
}

async function adicionarMeio(page, estado = 'previsto') {
  await page.locator('button[onclick="openAddTeam()"]').click();
  await page.locator('#modal-team').waitFor({ state: 'visible' });
  await page.fill('#team-eq', `VFCI-E2E-${Date.now()}`);
  await page.selectOption('#team-estado', estado);
  if (estado === 'previsto') {
    await page.fill('#team-previsto-data', '2026-06-02');
    await page.fill('#team-previsto-hora', '08:00');
  }
  await page.locator('#modal-team button:has-text("Guardar")').click();
  await page.locator('#modal-team').waitFor({ state: 'hidden' });
}

test.describe('Transições de estado de meios', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await criarOcorrencia(page);
  });

  test('adicionar meio previsto → aparece na secção Previstos', async ({ page }) => {
    await adicionarMeio(page, 'previsto');

    await expect(page.locator('.previsto-section')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.previsto-section')).toContainText('VFCI-E2E-');
  });

  test('Activar Trânsito → toast aparece e modal fecha', async ({ page }) => {
    await adicionarMeio(page, 'previsto');
    await expect(page.locator('.previsto-section')).toBeVisible({ timeout: 5000 });

    // Clicar no botão "Activar Trânsito" no card previsto
    await page.locator('.team-card.estado-previsto button:has-text("Activar Trânsito")').first().click();
    await page.locator('#modal-action').waitFor({ state: 'visible' });

    await page.locator('#modal-action button:has-text("Confirmar Trânsito")').click();

    // Toast de confirmação deve aparecer
    await expect(page.locator('#toast')).toContainText('Em Trânsito', { timeout: 5000 });

    // Modal deve fechar
    await expect(page.locator('#modal-action')).toBeHidden({ timeout: 3000 });
  });

  test('Activar Operação → toast com limite operacional', async ({ page }) => {
    await adicionarMeio(page, 'transito');

    // Botão real: "▶ Activar Op."
    await page.locator('.team-card button:has-text("Activar Op.")').first().click();
    await page.locator('#modal-action').waitFor({ state: 'visible' });

    const today = new Date().toISOString().split('T')[0];
    await page.fill('#qa-date', today);
    await page.fill('#qa-time', '10:00');
    await page.fill('#qa-hmax', '12');
    await page.locator('#modal-action button:has-text("Confirmar Activação")').click();

    await expect(page.locator('#toast')).toContainText('Em Operação', { timeout: 5000 });
    await expect(page.locator('#modal-action')).toBeHidden({ timeout: 3000 });
  });

  test('modal fecha após confirmar Descanso', async ({ page }) => {
    // Botão "⏸ Descanso" só aparece quando estado='operacao'
    // Adicionamos o meio já em operação directamente pelo formulário
    await adicionarMeio(page, 'operacao');

    await page.locator('.team-card button:has-text("Descanso")').first().click();
    await page.locator('#modal-action').waitFor({ state: 'visible' });
    await page.locator('#modal-action button:has-text("Confirmar Descanso")').click();

    await expect(page.locator('#toast')).toContainText('Descanso', { timeout: 5000 });
    await expect(page.locator('#modal-action')).toBeHidden({ timeout: 3000 });
  });

  test('Desmobilizar → toast "Desmobilizado"', async ({ page }) => {
    await adicionarMeio(page, 'transito');

    // Botão real: "✕ Desmob."
    await page.locator('.team-card button:has-text("Desmob.")').first().click();
    await page.locator('#modal-action').waitFor({ state: 'visible' });

    const today = new Date().toISOString().split('T')[0];
    await page.fill('#qa-demob-date', today);
    await page.fill('#qa-demob-time', '18:00');
    await page.locator('#modal-action button:has-text("Confirmar Desmob")').click();

    await expect(page.locator('#toast')).toContainText('Desmobilizado', { timeout: 5000 });
    await expect(page.locator('#modal-action')).toBeHidden({ timeout: 3000 });
  });
});
