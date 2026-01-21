const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });

    // Test range for New Taipei (Region 3)
    // Common IDs are around 26-52
    const startId = 26;
    const endId = 60;

    console.log('Mapping IDs for Region 3 (New Taipei)...');

    // We can run in parallel contexts to speed up
    const promises = [];
    const concurrency = 5;

    for (let i = startId; i <= endId; i += concurrency) {
        const chunk = [];
        for (let j = 0; j < concurrency && (i + j) <= endId; j++) {
            chunk.push(i + j);
        }

        await Promise.all(chunk.map(async (id) => {
            const context = await browser.newContext();
            const page = await context.newPage();
            try {
                const url = `https://rent.591.com.tw/list?region=3&section=${id}`;
                // console.log(`Checking ID ${id}...`);
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });

                // Find the active section filter
                // The active button usually has 'active' class
                const activeName = await page.evaluate(() => {
                    // Look for the active section button
                    const activeBtn = document.querySelector('.section .t5-checkbox__input:checked');
                    if (activeBtn) {
                        return activeBtn.parentElement.parentElement.textContent.trim();
                    }

                    // Fallback: check if the 'active' class is on a parent .filter-item or something
                    const activeItem = document.querySelector('.category-content.unlimit .options .active span');
                    if (activeItem) return activeItem.textContent.trim();

                    // Try to find text color change or just search for the item that matches the ID concept?
                    // Actually, if we pass section=ID, the corresponding checkbox should be checked.
                    // The selector above checks for checked input.

                    return null;
                });

                if (activeName) {
                    console.log(`ID ${id} => ${activeName}`);
                } else {
                    // console.log(`ID ${id} => No active filter found`);
                }
            } catch (e) {
                console.log(`ID ${id} => Error: ${e.message}`);
            } finally {
                await context.close();
            }
        }));
    }

    await browser.close();
})();
