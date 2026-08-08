const { test, expect } = require('@playwright/test');

test.describe('Chat functionality', () => {
  test('Chat UI renders correctly', async ({ page }) => {
    await page.goto('http://localhost:8080/reader-enhanced');
    
    // Check if the chat input exists
    const chatInput = page.locator('#chat-input');
    await expect(chatInput).toBeAttached();
    
    // Check if the send button exists
    const sendButton = page.locator('#ask-btn');
    await expect(sendButton).toBeAttached();
    
    // Check if the chat output area exists
    const chatOutput = page.locator('#chat-win');
    await expect(chatOutput).toBeAttached();
  });
});
