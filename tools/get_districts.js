const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // Taipei City (Region 1)
    console.log('Fetching Taipei City (Region 1) districts...');
    await page.goto('https://rent.591.com.tw/list?region=1');
    await page.waitForSelector('.filter-section-v2'); // Wait for filter area

    const taipeiDistricts = await page.evaluate(() => {
        // This selector might need adjustment based on actual site structure
        // Usually district options are in a list or dropdown
        // Let's try to find elements that look like district filters
        const elements = document.querySelectorAll('.filter-section-v2 .option');
        // Debug: print what we find
        return Array.from(elements).map(el => ({
            name: el.textContent.trim(),
            id: el.getAttribute('data-id') || el.getAttribute('value')
        }));
    });
    console.log('Taipei Districts:', JSON.stringify(taipeiDistricts, null, 2));

    // New Taipei City (Region 3)
    console.log('Fetching New Taipei City (Region 3) districts...');
    await page.goto('https://rent.591.com.tw/list?region=3');
    await page.waitForSelector('.filter-section-v2');

    const newTaipeiDistricts = await page.evaluate(() => {
        const elements = document.querySelectorAll('.filter-section-v2 .option');
        return Array.from(elements).map(el => ({
            name: el.textContent.trim(),
            id: el.getAttribute('data-id') || el.getAttribute('value')
        }));
    });
    console.log('New Taipei Districts:', JSON.stringify(newTaipeiDistricts, null, 2));

    await browser.close();
})();
