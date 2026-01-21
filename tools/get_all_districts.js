const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    async function getSectionId(name) {
        try {
            // Check if section is already in URL
            const currentUrl = page.url();
            if (currentUrl.includes(`section=`)) {
                await page.goto(currentUrl.split('?')[0] + `?region=${currentUrl.includes('region=3') ? 3 : 1}`);
                await page.waitForTimeout(1000);
            }

            // Click the district trigger (usually "鄉鎮市區")
            // This might differ based on mobile/desktop view, assume desktop for now
            // But simple text click often works if visible.
            // 591 UI is tricky. Let's try direct text click on the district name if visible
            // often they are in a list.

            // Try explicit locality
            const loc = page.locator(`css=.filter-list-item >> text=${name}`);
            if (await loc.isVisible()) {
                await loc.click();
            } else {
                // Try clicking "不限" or filtering area first if needed.
                // Simpler: Just force text search
                await page.click(`text=${name}`);
            }

            await page.waitForTimeout(1000);
            const url = page.url();
            const match = url.match(/section=(\d+)/);
            return match ? match[1] : 'not_found';
        } catch (e) {
            return `error`;
        }
    }

    try {
        console.log('--- TAIPEI (1) ---');
        await page.goto('https://rent.591.com.tw/list?region=1');
        await page.waitForTimeout(2000);
        // Common ones
        const tp = ['中正區', '大同區', '中山區', '松山區', '大安區', '萬華區', '信義區', '士林區', '北投區', '內湖區', '南港區', '文山區'];
        for (let n of tp) console.log(`${n}: ${await getSectionId(n)}`);

        console.log('--- NEW TAIPEI (3) ---');
        await page.goto('https://rent.591.com.tw/list?region=3');
        await page.waitForTimeout(2000);
        const ntp = ['板橋區', '三重區', '中和區', '永和區', '新莊區', '新店區', '淡水區', '土城區', '蘆洲區', '汐止區', '樹林區', '三峽區', '林口區'];
        for (let n of ntp) console.log(`${n}: ${await getSectionId(n)}`);

    } finally {
        await browser.close();
    }
})();
