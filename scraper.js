/**
 * 591 租屋網爬蟲模組
 * 使用 Playwright 爬取動態載入的租屋資訊
 */

const { chromium } = require('playwright');
const { execSync } = require('child_process');

// 確保 Playwright 瀏覽器已安裝
async function ensureBrowserInstalled() {
    try {
        // 嘗試取得瀏覽器路徑
        const browserPath = chromium.executablePath();
        const fs = require('fs');
        if (fs.existsSync(browserPath)) {
            console.log('✅ Chromium 瀏覽器已就緒');
            return true;
        }
    } catch (e) {
        // 瀏覽器不存在
    }

    console.log('📦 正在安裝 Chromium 瀏覽器...');
    try {
        execSync('npx playwright install chromium', {
            stdio: 'inherit',
            timeout: 300000 // 5 分鐘超時
        });
        console.log('✅ Chromium 安裝完成');
        return true;
    } catch (error) {
        console.error('❌ Chromium 安裝失敗:', error.message);
        return false;
    }
}

// 搜尋設定
const SEARCH_CONFIG = {
    baseUrl: 'https://rent.591.com.tw/list',
    regions: {
        taipei: 1,
        newTaipei: 3
    },
    filters: {
        nearSubway: 'near_subway',
        canCook: 'cook'
    }
};

/**
 * 建立搜尋 URL
 */
function buildSearchUrl(region, minRent, maxRent, keywords = '') {
    const params = new URLSearchParams({
        region: region.toString(),
        price: `${minRent}_${maxRent}`,
        other: `${SEARCH_CONFIG.filters.nearSubway},${SEARCH_CONFIG.filters.canCook}`
    });

    if (keywords) {
        params.append('keywords', keywords);
    }

    return `${SEARCH_CONFIG.baseUrl}?${params.toString()}`;
}

/**
 * 爬取單一地區的租屋列表
 */
async function scrapeRegion(page, region, minRent, maxRent) {
    const url = buildSearchUrl(region, minRent, maxRent, '乾濕分離');
    console.log(`📍 爬取: ${url}`);

    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

    // 等待列表載入 - 使用正確的 selector
    await page.waitForSelector('.item', { timeout: 30000 }).catch(() => {
        console.log('⚠️ 沒有找到物件列表');
    });

    // 額外等待確保動態內容載入完成
    await page.waitForTimeout(2000);

    // 滾動頁面以載入更多內容
    await autoScroll(page);

    // 提取物件資訊 - 使用正確的 selector
    const listings = await page.evaluate(() => {
        const items = document.querySelectorAll('.item');
        const results = [];

        items.forEach((item, index) => {
            try {
                // 標題和連結
                const titleEl = item.querySelector('.item-info-title a, .link.v-middle');
                const title = titleEl?.textContent?.trim() || '';
                const href = titleEl?.getAttribute('href') || '';
                const id = href.match(/\/(\d+)/)?.[1] || `unknown-${index}`;

                // 價格 - 正確的 selector
                const priceEl = item.querySelector('.item-info-price strong');
                let priceText = priceEl?.textContent?.trim() || '';
                const price = parseInt(priceText.replace(/[,元\/月]/g, '')) || 0;

                // 地址和其他資訊從 item-info-txt 提取
                const infoTxts = item.querySelectorAll('.item-info-txt');
                let address = '';
                let subway = '';
                let layout = '';

                infoTxts.forEach(txt => {
                    const text = txt.textContent?.trim() || '';
                    // 判斷是地址還是捷運還是格局
                    if (text.includes('區-') || text.includes('路') || text.includes('街')) {
                        address = text;
                    } else if (text.includes('公尺') || text.includes('捷運') || text.includes('站')) {
                        subway = text;
                    } else if (text.includes('房') || text.includes('坪') || text.includes('樓')) {
                        layout = text;
                    }
                });

                // 標籤（近捷運、可開伙等）
                const tags = [];
                item.querySelectorAll('.item-tag span, .tag').forEach(tag => {
                    tags.push(tag.textContent?.trim());
                });

                // 圖片
                const imgEl = item.querySelector('img');
                const image = imgEl?.src || '';

                if (title && price > 0) {
                    results.push({
                        id,
                        title,
                        price,
                        address,
                        layout,
                        tags,
                        subway,
                        image,
                        url: `https://rent.591.com.tw/${id}`
                    });
                }
            } catch (e) {
                console.error('解析錯誤:', e);
            }
        });

        return results;
    });

    return listings;
}

/**
 * 自動滾動頁面以載入更多內容
 */
async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 500;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= scrollHeight - window.innerHeight || totalHeight > 3000) {
                    clearInterval(timer);
                    resolve();
                }
            }, 200);
        });
    });

    // 等待新內容載入
    await page.waitForTimeout(1000);
}

/**
 * 取得物件詳細資訊
 */
async function getListingDetails(page, url) {
    try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

        const details = await page.evaluate(() => {
            // 設備列表
            const equipments = [];
            document.querySelectorAll('.service-list-item, .facility span, .icon-item').forEach(el => {
                const text = el.textContent?.trim();
                if (text) equipments.push(text);
            });

            // 屋主說明（檢查乾濕分離）
            const descEl = document.querySelector('.house-intro, .description, .info-content');
            const description = descEl?.textContent?.trim() || '';

            // 是否有乾濕分離
            const hasDryWetSeparation = description.includes('乾濕分離') ||
                equipments.some(e => e.includes('乾濕分離'));

            // 捷運距離
            const subwayInfo = document.querySelector('.traffic-info, .metro-info, .subway-distance');
            const subwayDistance = subwayInfo?.textContent?.trim() || '';

            return {
                equipments,
                description: description.substring(0, 500),
                hasDryWetSeparation,
                subwayDistance
            };
        });

        return details;
    } catch (e) {
        console.error(`取得詳情失敗: ${url}`, e.message);
        return null;
    }
}

/**
 * 主要爬蟲函數
 */
async function scrape591(options = {}) {
    const {
        regions = [1, 3], // 台北市, 新北市
        minRent = 8000,
        maxRent = 12000,
        maxResults = 20
    } = options;

    console.log('🚀 開始爬取 591 租屋網...');
    console.log(`📊 條件: 租金 ${minRent}-${maxRent} 元, 地區: ${regions.join(', ')}`);

    // 確保瀏覽器已安裝
    await ensureBrowserInstalled();

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 }
    });

    const page = await context.newPage();
    let allListings = [];

    try {
        // 爬取每個地區
        for (const region of regions) {
            const regionName = region === 1 ? '台北市' : '新北市';
            console.log(`\n🏙️ 正在爬取: ${regionName}`);

            const listings = await scrapeRegion(page, region, minRent, maxRent);
            console.log(`   找到 ${listings.length} 間物件`);

            // 為每個物件添加地區標記
            listings.forEach(l => {
                l.region = regionName;
            });

            allListings = allListings.concat(listings);
        }

        // 限制結果數量
        if (allListings.length > maxResults) {
            allListings = allListings.slice(0, maxResults);
        }

        console.log(`\n✅ 總共找到 ${allListings.length} 間符合條件的物件`);

    } catch (error) {
        console.error('❌ 爬蟲錯誤:', error);
    } finally {
        await browser.close();
    }

    return allListings;
}

module.exports = {
    scrape591,
    buildSearchUrl,
    getListingDetails
};
