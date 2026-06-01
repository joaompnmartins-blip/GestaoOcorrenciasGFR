'use strict';
const { test, expect } = require('@playwright/test');

// Helper reutilizável — login num página fresca
async function login(page, email, password) {
  await page.goto('/');
  await page.fill('#auth-email', email);
  await page.fill('#auth-pass', password);
  await page.click('#auth-btn');
}

test.describe('Autenticação', () => {
  test('login com credenciais válidas entra na aplicação', async ({ page }) => {
    await login(page, 'admin@test.pt', 'test123');

    // Auth overlay desaparece e topbar mostra o nome
    await expect(page.locator('#auth-overlay')).toHaveClass(/hidden/, { timeout: 5000 });
    await expect(page.locator('#topbar-user')).toContainText('Admin Teste');
  });

  test('login com password errada mostra erro', async ({ page }) => {
    await login(page, 'admin@test.pt', 'errada');

    await expect(page.locator('#auth-err')).not.toBeEmpty({ timeout: 3000 });
  });

  test('logout volta ao ecrã de login', async ({ page }) => {
    await login(page, 'admin@test.pt', 'test123');
    await expect(page.locator('#auth-overlay')).toHaveClass(/hidden/, { timeout: 5000 });

    await page.click('#btn-logout');

    await expect(page.locator('#auth-overlay')).not.toHaveClass(/hidden/, { timeout: 3000 });
  });

  test('reload mantém sessão (sessionStorage)', async ({ page }) => {
    await login(page, 'admin@test.pt', 'test123');
    await expect(page.locator('#auth-overlay')).toHaveClass(/hidden/, { timeout: 5000 });

    await page.reload();

    await expect(page.locator('#auth-overlay')).toHaveClass(/hidden/, { timeout: 5000 });
    await expect(page.locator('#topbar-user')).not.toBeEmpty();
  });

  test('perfil visualizador — botão Nova Ocorrência não visível', async ({ page }) => {
    await login(page, 'viz@test.pt', 'test123');
    await expect(page.locator('#auth-overlay')).toHaveClass(/hidden/, { timeout: 5000 });

    // #btnNew tem classe auth-gestor — não deve estar visível para visualizador
    await expect(page.locator('#btnNew')).toBeHidden();
  });
});
