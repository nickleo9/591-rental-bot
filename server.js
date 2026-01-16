/**
 * 591 租屋爬蟲系統 - 主伺服器
 * 
 * 功能：
 * 1. 定時爬取 591 租屋網
 * 2. 透過 LINE Bot 發送通知
 * 3. 將資料儲存到 Google Sheets
 * 4. 處理使用者互動（標記有興趣）
 */

require('dotenv').config();

const express = require('express');
const cron = require('node-cron');
const { scrape591 } = require('./scraper');
const { sendListingsNotification, handlePostback, client } = require('./linebot');
const { saveListings, markAsInterested, initSheets } = require('./sheets');

const app = express();
const PORT = process.env.PORT || 3000;

// 搜尋設定（可透過 LINE 動態調整）
const SEARCH_CONFIG = {
    regions: (process.env.SEARCH_REGIONS || '1,3').split(',').map(Number),
    minRent: parseInt(process.env.MIN_RENT) || 8000,
    maxRent: parseInt(process.env.MAX_RENT) || 12000
};

// 儲存使用者 ID（第一次發訊息時會記錄）
let subscribedUsers = new Set();
if (process.env.LINE_USER_ID) {
    subscribedUsers.add(process.env.LINE_USER_ID);
}

/**
 * 回覆文字訊息
 */
async function replyText(replyToken, text) {
    await client.replyMessage({
        replyToken,
        messages: [{ type: 'text', text }]
    });
}

/**
 * 主要爬蟲任務
 */
async function runCrawlTask() {
    console.log('\n========================================');
    console.log('🚀 開始執行爬蟲任務...');
    console.log(`📅 時間: ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`);
    console.log('========================================\n');

    try {
        // 1. 爬取 591
        const listings = await scrape591({
            regions: SEARCH_CONFIG.regions,
            minRent: SEARCH_CONFIG.minRent,
            maxRent: SEARCH_CONFIG.maxRent,
            maxResults: 20
        });

        if (listings.length === 0) {
            console.log('📭 沒有找到符合條件的物件');

            // 通知用戶
            for (const userId of subscribedUsers) {
                await sendListingsNotification(userId, []);
            }
            return;
        }

        console.log(`\n📊 爬取到 ${listings.length} 間物件`);

        // 2. 儲存到 Google Sheets
        const { saved, new: newListings } = await saveListings(listings);
        console.log(`💾 新增 ${saved} 間物件到 Sheets`);

        // 3. 發送 LINE 通知（只通知新物件）
        if (newListings.length > 0) {
            for (const userId of subscribedUsers) {
                await sendListingsNotification(userId, newListings);
            }
        } else {
            console.log('📭 沒有新物件需要通知');
        }

        console.log('\n✅ 爬蟲任務完成！');

    } catch (error) {
        console.error('❌ 爬蟲任務失敗:', error);
    }
}

// ============================================
// Express 路由
// ============================================

// 健康檢查
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        name: '591 租屋爬蟲系統',
        subscribedUsers: subscribedUsers.size,
        config: SEARCH_CONFIG,
        nextRun: process.env.CRON_SCHEDULE || '0 11 * * *'
    });
});

// 手動觸發爬蟲
app.get('/crawl', async (req, res) => {
    res.json({ message: '爬蟲任務已啟動' });
    runCrawlTask();
});

// LINE Webhook
app.post('/webhook', express.json(), async (req, res) => {
    try {
        const events = req.body.events || [];

        for (const event of events) {
            console.log('📩 收到 LINE 事件:', event.type);

            // 記錄使用者 ID
            if (event.source && event.source.userId) {
                const userId = event.source.userId;
                if (!subscribedUsers.has(userId)) {
                    subscribedUsers.add(userId);
                    console.log(`👤 新增訂閱用戶: ${userId}`);

                    // 更新 .env 提醒
                    console.log(`\n⚠️ 請將以下 ID 加入 .env 的 LINE_USER_ID:`);
                    console.log(`   LINE_USER_ID=${userId}\n`);
                }
            }

            // 處理不同類型的事件
            switch (event.type) {
                case 'message':
                    // 收到文字訊息
                    if (event.message.type === 'text') {
                        const text = event.message.text.trim();
                        const lowerText = text.toLowerCase();

                        // 指令列表
                        if (lowerText === '指令' || lowerText === '說明' || lowerText === 'help') {
                            await replyText(event.replyToken,
                                `📋 可用指令：

🔍 搜尋指令：
• 搜尋 / 找房 - 立即搜尋
• 狀態 - 查看目前設定

⚙️ 調整參數：
• 租金 8000-15000 - 設定租金範圍
• 地區 台北 - 只搜台北
• 地區 新北 - 只搜新北
• 地區 全部 - 搜台北+新北

📝 範例：
「租金 5000-10000」
「地區 台北」`);
                        }
                        // 查看狀態
                        else if (lowerText === '狀態' || lowerText === 'status') {
                            const regions = SEARCH_CONFIG.regions.map(r => r === 1 ? '台北市' : '新北市').join('、');
                            await replyText(event.replyToken,
                                `📊 目前設定：

💰 租金範圍：${SEARCH_CONFIG.minRent.toLocaleString()} - ${SEARCH_CONFIG.maxRent.toLocaleString()} 元
🏙️ 搜尋地區：${regions}
⏰ 每日通知：11:00

輸入「指令」查看更多操作`);
                        }
                        // 調整租金
                        else if (text.startsWith('租金')) {
                            const match = text.match(/(\d+)[^\d]+(\d+)/);
                            if (match) {
                                const min = parseInt(match[1]);
                                const max = parseInt(match[2]);
                                if (min < max && min >= 1000 && max <= 100000) {
                                    SEARCH_CONFIG.minRent = min;
                                    SEARCH_CONFIG.maxRent = max;
                                    await replyText(event.replyToken,
                                        `✅ 租金範圍已更新！

💰 新範圍：${min.toLocaleString()} - ${max.toLocaleString()} 元/月

輸入「搜尋」立即查找`);
                                } else {
                                    await replyText(event.replyToken, '❌ 請輸入有效的租金範圍（1,000 - 100,000）\n範例：租金 8000-15000');
                                }
                            } else {
                                await replyText(event.replyToken, '❌ 格式錯誤\n範例：租金 8000-15000');
                            }
                        }
                        // 調整地區
                        else if (text.startsWith('地區')) {
                            const area = text.replace('地區', '').trim();
                            if (area.includes('台北') && !area.includes('新北')) {
                                SEARCH_CONFIG.regions = [1];
                                await replyText(event.replyToken, '✅ 已設定只搜尋台北市');
                            } else if (area.includes('新北') && !area.includes('台北')) {
                                SEARCH_CONFIG.regions = [3];
                                await replyText(event.replyToken, '✅ 已設定只搜尋新北市');
                            } else if (area.includes('全') || (area.includes('台北') && area.includes('新北'))) {
                                SEARCH_CONFIG.regions = [1, 3];
                                await replyText(event.replyToken, '✅ 已設定搜尋台北市 + 新北市');
                            } else {
                                await replyText(event.replyToken, '❌ 請輸入：地區 台北 / 地區 新北 / 地區 全部');
                            }
                        }
                        // 手動搜尋
                        else if (lowerText.includes('搜尋') || lowerText.includes('找房') || lowerText === '開始') {
                            await replyText(event.replyToken, '🔍 正在搜尋中，請稍候...');
                            runCrawlTask();
                        }
                    }
                    break;

                case 'postback':
                    // 使用者點擊按鈕
                    const result = await handlePostback(event);

                    if (result && result.action === 'interested') {
                        // 標記為有興趣
                        await markAsInterested(result.id, result.title, result.price);
                    }
                    break;

                case 'follow':
                    // 用戶加入好友
                    console.log('🎉 新用戶加入:', event.source.userId);
                    break;
            }
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('Webhook 錯誤:', error);
        res.status(500).send('Error');
    }
});

// ============================================
// 排程設定
// ============================================

// 每天 11:00 執行（台灣時間）
const cronSchedule = process.env.CRON_SCHEDULE || '0 11 * * *';
console.log(`⏰ 排程設定: ${cronSchedule}`);

cron.schedule(cronSchedule, () => {
    console.log('⏰ 定時任務觸發');
    runCrawlTask();
}, {
    timezone: 'Asia/Taipei'
});

// ============================================
// 啟動伺服器
// ============================================

async function start() {
    try {
        // 初始化 Google Sheets
        await initSheets();

        // 啟動伺服器
        app.listen(PORT, () => {
            console.log('\n========================================');
            console.log('🏠 591 租屋爬蟲系統已啟動！');
            console.log('========================================');
            console.log(`📡 伺服器: http://localhost:${PORT}`);
            console.log(`📡 Webhook: http://localhost:${PORT}/webhook`);
            console.log(`📡 手動爬取: http://localhost:${PORT}/crawl`);
            console.log(`⏰ 定時排程: ${cronSchedule}`);
            console.log(`🏙️ 搜尋地區: ${SEARCH_CONFIG.regions.map(r => r === 1 ? '台北市' : '新北市').join(', ')}`);
            console.log(`💰 租金範圍: ${SEARCH_CONFIG.minRent} - ${SEARCH_CONFIG.maxRent} 元`);
            console.log('========================================\n');

            if (subscribedUsers.size === 0) {
                console.log('⚠️ 提示: 請先用 LINE 發送訊息給 Bot 以取得你的 User ID');
                console.log('   然後將 User ID 加入 .env 的 LINE_USER_ID\n');
            }
        });
    } catch (error) {
        console.error('❌ 啟動失敗:', error);
    }
}

start();
