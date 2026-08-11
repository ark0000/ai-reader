const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

async function run() {
  console.log('Starting puppeteer...');
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  
  // 1. Create a dummy PDF file
  const pdfPath = path.join(__dirname, 'dummy_test.pdf');
  if (!fs.existsSync(pdfPath)) {
      // Just write a minimal PDF header for pdf.js to detect it as a PDF.
      // Wait, pdf.js requires a valid PDF. Let's create a minimal valid PDF.
      const minimalPdf = Buffer.from(
          "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n" +
          "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n" +
          "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n" +
          "4 0 obj\n<< /Length 0 >>\nstream\nendstream\nendobj\n" +
          "xref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n" +
          "0000000115 00000 n \n0000000204 00000 n \ntrailer\n<< /Size 5 /Root 1 0 R >>\n" +
          "startxref\n253\n%%EOF", 'utf-8'
      );
      fs.writeFileSync(pdfPath, minimalPdf);
  }

  try {
      console.log('Navigating to reader-enhanced...');
      await page.goto('http://localhost:8080/reader-enhanced', { waitUntil: 'networkidle0' });

      // 2. Set username to 'arun'
      console.log('Setting username...');
      await page.evaluate(() => {
          window.logUI = console.log;
          const input = document.getElementById('username-input');
          input.value = 'arun';
          input.dispatchEvent(new Event('change'));
          
          window.safeStorage.setItem('aura-pdf-reading-state', 'true');
          window.safeStorage.setItem('aura-notes-state', 'true');
      });
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      await sleep(500);

      // 3. Upload the PDF
      console.log('Uploading PDF...');
      const fileInput = await page.$('#file-upload');
      await fileInput.uploadFile(pdfPath);
      
      // Wait for the PDF to load
      await sleep(3000);
      
      // Check if document was saved
      const libraryBefore = await page.evaluate(async () => {
          return await window.storageRepository.getLibraryMeta('arun');
      });
      console.log('Library before scroll:', libraryBefore);

      // 4. Scroll to trigger save
      console.log('Scrolling...');
      await page.evaluate(() => {
          window.contentEl.scrollTop = 500;
          window.contentEl.dispatchEvent(new Event('scroll'));
      });
      
      // Wait 3 seconds for debounce
      await sleep(3000);

      const libraryAfter = await page.evaluate(async () => {
          return await window.storageRepository.getLibraryMeta('arun');
      });
      console.log('Library after scroll:', libraryAfter);

      // 5. Reload the page to test auto-restore
      console.log('Reloading page...');
      await page.reload({ waitUntil: 'networkidle0' });
      
      // Wait for auto-load to finish and scroll to restore
      await sleep(500);
      await page.evaluate(() => { window.logUI = console.log; });
      await sleep(2500);
      
      const restoredScroll = await page.evaluate(() => {
          return window.contentEl ? window.contentEl.scrollTop : -1;
      });
      console.log('Restored scroll top:', restoredScroll);

  } catch(e) {
      console.error(e);
  } finally {
      await browser.close();
      if(fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
  }
}

run();
