/**
 * LINE Bot 測試腳本
 * 用於驗證 LINE 通知功能
 */

require('dotenv').config();

const { sendListingsNotification } = require('./linebot');

// 測試資料
const testListings = [
    {
        id: '12345678',
        title: '【測試】行天宮站旁精美套房',
        price: 9800,
        address: '中山區松江路',
        region: '台北市',
        subway: '距行天宮站 200m',
        tags: ['近捷運', '可開伙'],
        url: 'https://rent.591.com.tw/12345678'
    },
    {
        id: '87654321',
        title: '【測試】板橋新埔站全新裝潢',
        price: 11000,
        address: '板橋區文化路',
        region: '新北市',
        subway: '距新埔站 350m',
        tags: ['近捷運', '可開伙', '有陽台'],
        url: 'https://rent.591.com.tw/87654321'
    }
];

async function testLineBot() {
    console.log('🧪 開始測試 LINE Bot...\n');

    const userId = process.env.LINE_USER_ID;

    if (!userId) {
        console.log('❌ 錯誤: 請先在 .env 設定 LINE_USER_ID');
        console.log('');
        console.log('   取得方式:');
        console.log('   1. 啟動伺服器 (npm start)');
        console.log('   2. 用 LINE 發送任意訊息給 Bot');
        console.log('   3. 查看 console 輸出的 User ID');
        console.log('   4. 將 ID 加入 .env');
        return;
    }

    console.log(`📤 發送測試通知給用戶: ${userId}\n`);

    try {
        await sendListingsNotification(userId, testListings);
        console.log('✅ LINE 通知發送成功！');
        console.log('   請檢查你的 LINE 是否收到訊息\n');
    } catch (error) {
        console.error('❌ LINE 通知發送失敗:', error.message);

        if (error.message.includes('Invalid reply token')) {
            console.log('\n   可能原因: Reply Token 已過期或無效');
        } else if (error.message.includes('401')) {
            console.log('\n   可能原因: Channel Access Token 無效');
            console.log('   請檢查 .env 中的 LINE_CHANNEL_ACCESS_TOKEN');
        }
    }
}

testLineBot();
