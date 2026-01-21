const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    async function getSectionId(name) {
        try {
            const element = page.getByText(name, { exact: true }).first();
            await element.click();
            await page.waitForTimeout(500);
            const url = page.url();
            const match = url.match(/section=(\d+)/);
            return match ? match[1] : 'Not found';
        } catch (e) {
            return 'Error';
        }
    }

    try {
        console.log('Checking Taipei...');
        await page.goto('https://rent.591.com.tw/list?region=1');
        await page.waitForTimeout(3000);
        console.log('Zhongzheng (中正區):', await getSectionId('中正區'));

    } finally {
        await browser.close();
    }
})();
