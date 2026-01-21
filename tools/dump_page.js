const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        console.log('Fetching page...');
        await page.goto('https://rent.591.com.tw/list?region=1', { timeout: 60000 });
        // Wait for some content to load
        await page.waitForTimeout(5000);

        const content = await page.content();
        fs.writeFileSync('page_dump.html', content);
        console.log('Page dumped to page_dump.html');
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await browser.close();
    }
})();
