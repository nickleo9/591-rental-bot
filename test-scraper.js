/**
 * 爬蟲測試腳本
 * 用於驗證爬蟲功能是否正常
 */

require('dotenv').config();

const { scrape591 } = require('./scraper');

async function testScraper() {
    console.log('🧪 開始測試爬蟲...\n');

    try {
        const listings = await scrape591({
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
            console.log('   可能原因:');
            console.log('   - 591 網站結構已更新');
            console.log('   - 網路連接問題');
            console.log('   - 被反爬蟲機制阻擋');
            return;
        }

        listings.forEach((listing, index) => {
            console.log(`${index + 1}. ${listing.title}`);
            console.log(`   💰 租金: ${listing.price.toLocaleString()} 元/月`);
            console.log(`   📍 地區: ${listing.region}`);
            console.log(`   🏠 地址: ${listing.address || '未知'}`);
            console.log(`   🚇 捷運: ${listing.subway || '未知'}`);
            console.log(`   🔗 連結: ${listing.url}`);
            console.log('');
        });

        console.log('✅ 爬蟲測試成功！\n');

    } catch (error) {
        console.error('❌ 爬蟲測試失敗:', error);
    }
}

testScraper();
