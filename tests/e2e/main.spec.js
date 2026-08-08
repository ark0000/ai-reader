const { test, expect } = require('@playwright/test');

test.describe('Main Page functionality', () => {
  test('Main page renders correctly', async ({ page }) => {
    await page.goto('http://localhost:8080/');
    
    // Check if the logo exists
    const logo = page.locator('.logo h1');
    await expect(logo).toBeVisible();
    await expect(logo).toContainText('AuraPDF');
    
    // Check if the Open AI Reader button exists
    const readerBtn = page.locator('text=Open AI Reader');
    await expect(readerBtn).toBeVisible();
    
    // Check if the drag and drop zone exists
    const dropZone = page.locator('#drop-zone');
    await expect(dropZone).toBeVisible();
    
    // Check if the file input exists (it's hidden, so we check if it's attached)
    const fileInput = page.locator('#file-input');
    await expect(fileInput).toBeAttached();
    
    // Check if the settings grid exists
    const settingsGrid = page.locator('.settings-grid');
    await expect(settingsGrid).toBeVisible();
  });

  test('Theme Preset dropdown updates value and toggles custom panel', async ({ page }) => {
    await page.goto('http://localhost:8080/');
    
    const themeSelect = page.locator('#theme-select');
    const customPanel = page.locator('#custom-colors-panel');
    
    await expect(themeSelect).toBeVisible();
    await expect(themeSelect).toHaveValue('comfort'); // default
    await expect(customPanel).toBeHidden(); // default hidden
    
    // Select a built-in theme
    await themeSelect.selectOption('deep_space');
    await expect(themeSelect).toHaveValue('deep_space');
    await expect(customPanel).toBeHidden();
    
    // Select custom theme
    await themeSelect.selectOption('custom');
    await expect(themeSelect).toHaveValue('custom');
    await expect(customPanel).toBeVisible();
    
    // Select built-in again
    await themeSelect.selectOption('monochrome');
    await expect(customPanel).toBeHidden();
  });

  test('Settings sliders update displayed values', async ({ page }) => {
    await page.goto('http://localhost:8080/');
    
    // Test DPI slider
    const dpiSlider = page.locator('#dpi-slider');
    await dpiSlider.fill('200');
    await dpiSlider.dispatchEvent('input');
    await expect(page.locator('#dpi-val')).toHaveText('200 DPI');

    // Test Quality slider
    const qualitySlider = page.locator('#quality-slider');
    await qualitySlider.fill('60');
    await qualitySlider.dispatchEvent('input');
    await expect(page.locator('#quality-val')).toHaveText('60%');

    // Test Brightness slider
    const brightnessSlider = page.locator('#brightness-slider');
    await brightnessSlider.fill('1.5');
    await brightnessSlider.dispatchEvent('input');
    await expect(page.locator('#brightness-val')).toHaveText('1.5x');
  });

  test('Smart Invert checkbox can be toggled', async ({ page }) => {
    await page.goto('http://localhost:8080/');
    
    const smartInvert = page.locator('#smart-invert');
    const smartInvertLabel = page.locator('label[for="smart-invert"]');
    await expect(smartInvert).toBeChecked(); // default is checked
    
    await smartInvertLabel.click({ force: true });
    await expect(smartInvert).not.toBeChecked();
    
    await smartInvertLabel.click({ force: true });
    await expect(smartInvert).toBeChecked();
  });

  test('Authentication flow - opening modal and logging in', async ({ page }) => {
    await page.goto('http://localhost:8080/');
    
    // Click login button
    const loginBtn = page.locator('#open-login-btn');
    await expect(loginBtn).toBeVisible();
    await loginBtn.click();
    
    // Check modal appears
    const authModal = page.locator('#auth-modal');
    await expect(authModal).toBeVisible();
    
    // Fill credentials
    await page.locator('#auth-username-input').fill('testuser');
    await page.locator('#auth-password-input').fill('testpass');
    
    // We won't submit the form to avoid creating real DB records if API isn't mocked,
    // but we can check if the button exists and is clickable.
    const submitBtn = page.locator('#auth-submit-btn');
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toContainText('Sign In');
  });
});
