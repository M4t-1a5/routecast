import { expect, test } from '@playwright/test';
import { mockApis } from './mocks';

test.describe('RouteCast — parcours de démo', () => {
  test.beforeEach(async ({ page }) => {
    await mockApis(page);
  });

  test('import du GPX de démo → carte, profil, météo et synthèse affichés', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/');
    await expect(page.getByTestId('map')).toBeVisible();
    await page.getByRole('button', { name: /Essayer avec la démo/i }).click();

    // Profil d'altitude rendu (canvas uPlot)
    const profile = page.getByTestId('profile').first();
    await expect(profile).toBeVisible();
    await expect(profile.locator('canvas').first()).toBeVisible();

    // Distance de la démo (~96 km) et météo chargée (confiance + résumé)
    const aside = page.getByRole('complementary', { name: /Trace et réglages/i });
    await expect(aside).toContainText(/9\d,\d\s*km/);
    await expect(aside.getByText(/Confiance (élevée|moyenne|faible)/i)).toBeVisible({ timeout: 20_000 });
    await expect(aside.getByText('Résumé de la sortie')).toBeVisible();
    await expect(aside.getByText(/Vent de (face|dos)|Risque d'averse|Conditions/i).first()).toBeVisible();

    // Sélecteur de couches : bascule vers Température
    await page.getByRole('radio', { name: /Température/i }).click();
    await expect(page.getByRole('radio', { name: /Température/i })).toHaveAttribute('aria-checked', 'true');

    // Survol du profil → infobulle
    const box = await profile.locator('canvas').first().boundingBox();
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByText(/km\s/).first()).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('fichier invalide → message d’erreur clair', async ({ page }) => {
    await page.goto('/');
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: 'nimporte.gpx',
        mimeType: 'application/gpx+xml',
        buffer: Buffer.from('<gpx><oops>'),
      });
    await expect(page.getByRole('alert').first()).toBeVisible();
  });
});
