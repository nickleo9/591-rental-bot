const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
        // Taipei City (Region 1)
        console.log('Fetching Taipei City (Region 1)...');
        await page.goto('https://rent.591.com.tw/list?region=1', { timeout: 60000 });

        // Wait for filtering options to appear
        // Instead of a specific class, wait for a known district name to appear
        await page.waitForTimeout(5000);

        // Function to find section ID by district name
        async function getSectionId(name) {
            try {
                // Click the district
                const element = page.getByText(name, { exact: true }).first();
                await element.click();

                // Wait for URL to change or just grab it
                // 591 updates URL with pushState usually
                await page.waitForTimeout(500);
                const url = page.url();

                // Extract section from URL (e.g., &section=5)
                const match = url.match(/section=(\d+)/);
                return match ? match[1] : 'Not found in URL';
            } catch (e) {
                return 'Click failed';
            }
        }

        const taipeiDistricts = ['中山區', '大同區', '大安區', '信義區'];
        for (const district of taipeiDistricts) {
            const id = await getSectionId(district);
            console.log(`Taipei - ${district}: ${id}`);
        }

        // New Taipei City (Region 3)
        console.log('\nFetching New Taipei City (Region 3)...');
        await page.goto('https://rent.591.com.tw/list?region=3', { timeout: 60000 });
        await page.waitForTimeout(5000);

        const newTaipeiDistricts = ['永和區', '板橋區', '中和區'];
        for (const district of newTaipeiDistricts) {
            const id = await getSectionId(district);
            console.log(`New Taipei - ${district}: ${id}`);
        }

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await browser.close();
    }
})();
