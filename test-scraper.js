/**
 * 爬蟲測試腳本
 * 用於驗證爬蟲功能是否正常
 */

require('dotenv').config();

const { scrape591 } = require('./scraper');

async function testScraper() {
    console.log('🧪 開始測試爬蟲...\n');

    try {
        const { listings } = await scrape591({
            regions: [1, 3], // 台北市, 新北市
            minRent: 8000,
            maxRent: 12000,
            maxResults: 5
        });

        console.log('\n========================================');
        console.log('📊 爬取結果:');
        console.log('========================================\n');

        if (listings.length === 0) {
            console.log('❌ 沒有找到任何物件');
            require('fs').writeFileSync('result.json', JSON.stringify({ error: 'No listings found', listings: [] }, null, 2));
            return;
        }

        listings.forEach((listing, index) => {
            console.log(`${index + 1}. ${listing.title}`);
            // ... logs ...
        });

        require('fs').writeFileSync('result.json', JSON.stringify({ success: true, count: listings.length, listings }, null, 2));
        console.log('✅ 爬蟲測試成功！結果已寫入 result.json\n');

    } catch (error) {
        console.error('❌ 爬蟲測試失敗:', error);
        require('fs').writeFileSync('result.json', JSON.stringify({ error: error.message, stack: error.stack }, null, 2));
    }
}

testScraper();
