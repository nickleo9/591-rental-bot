const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    console.log('Navigating to 591...');
    await page.goto('https://rent.591.com.tw/?region=3', { waitUntil: 'networkidle' });

    // Dump HTML
    const html = await page.content();
    fs.writeFileSync('591_dump.html', html);
    console.log('HTML dumped to 591_dump.html');

    await browser.close();
})();
