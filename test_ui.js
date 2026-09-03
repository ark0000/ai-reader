const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  
  await page.goto('http://localhost:8500/reader-enhanced', { waitUntil: 'networkidle0' });
  
  // Make the modal visible
  await page.evaluate(() => {
      if (typeof openExternalNotes === 'function') {
          openExternalNotes();
      } else {
          document.getElementById('external-notes-overlay').style.display = 'flex';
      }
  });
  
  // Wait for it to be visible
  await new Promise(r => setTimeout(r, 500));
  
  const btnTools = await page.$('#btn-tools');
  console.log('btnTools found:', !!btnTools);
  
  if (btnTools) {
      console.log('Clicking btn-tools...');
      await btnTools.click();
      await new Promise(r => setTimeout(r, 500));
      const display = await page.evaluate(() => document.getElementById('tools-dropdown-menu').style.display);
      console.log('menuContainer display after click:', display);
      
      // Now click the deep_dive template
      const deepDiveBtn = await page.$('[data-template-id="deep_dive"]');
      if (deepDiveBtn) {
          console.log('Clicking deep_dive template...');
          await deepDiveBtn.click();
          await new Promise(r => setTimeout(r, 500));
          
          // Verify injection
          const quillText = await page.evaluate(() => {
              return window.quillEditor ? window.quillEditor.getText() : null;
          });
          console.log('Quill text after injection:', quillText);
      } else {
          console.log('deepDiveBtn not found');
      }
  }
  
  await browser.close();
})();
