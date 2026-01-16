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

const line = require('@line/bot-sdk');
const express = require('express');
const cron = require('node-cron');
// 引入其他模組
const { scrape591, buildSearchUrl, SEARCH_CONFIG: ScraperConfig } = require('./scraper');
const { sendListingsNotification, handlePostback, client: lineClient, startLoading } = require('./linebot');
const { saveListings, markAsInterested, initSheets } = require('./sheets');

const app = express();
const PORT = process.env.PORT || 3000;

// 搜尋設定（可透過 LINE 動態調整）
// 初始化預設值
const SEARCH_CONFIG = {
    // 預設鎖定區域: 中正(1), 中山(3), 大同(2), 永和(37)
    targets: [
        { region: 1, section: 1, name: '台北市-中正區' },
        { region: 1, section: 3, name: '台北市-中山區' },
        { region: 1, section: 2, name: '台北市-大同區' },
        { region: 3, section: 37, name: '新北市-永和區' }
    ],
    minRent: parseInt(process.env.MIN_RENT) || 8000,
    maxRent: parseInt(process.env.MAX_RENT) || 12000
};

// 儲存使用者 ID（第一次發訊息時會記錄）
let subscribedUsers = new Set();
if (process.env.LINE_USER_ID) {
    subscribedUsers.add(process.env.LINE_USER_ID);
}

// 爬蟲狀態鎖
let isCrawling = false;

/**
 * 回覆文字訊息
 */
async function replyText(replyToken, text) {
    await lineClient.replyMessage({
        replyToken,
        messages: [{ type: 'text', text }]
    });
}

/**
 * 執行爬蟲任務
 */
async function runCrawlTask(manual = false) {
    if (isCrawling) {
        return { status: 'running', message: '爬蟲正在執行中...' };
    }

    isCrawling = true;
    console.log(`[${new Date().toLocaleString()}] 執行爬蟲任務 (手動: ${manual})`);

    try {
        // 定義進度回調函數
        const onProgress = async (message) => {
            try {
                await lineClient.broadcast({
                    messages: [{ type: 'text', text: message }]
                });
            } catch (e) {
                console.error('發送進度通知失敗:', e);
            }
        };

        // 1. 執行爬蟲
        const { listings, logs } = await scrape591({
            targets: SEARCH_CONFIG.targets,
            minRent: SEARCH_CONFIG.minRent,
            maxRent: SEARCH_CONFIG.maxRent,
            maxResults: 20,
            onProgress // 傳入回調
        });

        // 2. 儲存到 Google Sheets
        const { saved, new: newListings } = await saveListings(listings);

        // 準備 Log 訊息
        const logMessage = logs.length > 0 ? logs.join('\n') + '\n\n' : '';

        // 3. 發送通知
        if (newListings.length > 0) {
            // 有新物件：發送新物件通知
            const message = `🏠 找到 ${newListings.length} 間新物件！\n(篩選條件: ${SEARCH_CONFIG.minRent}-${SEARCH_CONFIG.maxRent}元)`;

            // 發送給所有訂閱用戶
            for (const userId of subscribedUsers) {
                await lineClient.pushMessage({
                    to: userId,
                    messages: [{ type: 'text', text: message }]
                });
                await sendListingsNotification(userId, newListings);
            }
        } else if (manual && listings.length > 0) {
            // 手動搜尋且無新物件：顯示全部結果
            const targetNames = SEARCH_CONFIG.targets.map(t => t.name.split('-')[1]).join('、');
            const message = `📋 目前沒有新物件，但為您列出資料庫中的 ${listings.length} 間物件：\n(監控區域: ${targetNames})`;

            // 發送給所有訂閱用戶
            const listingsToShow = listings.slice(0, 10);
            for (const userId of subscribedUsers) {
                await lineClient.pushMessage({
                    to: userId,
                    messages: [{ type: 'text', text: message }]
                });
                await sendListingsNotification(userId, listingsToShow);
            }
        } else {
            // 沒有新物件（自動排程）
            const targetNames = SEARCH_CONFIG.targets.map(t => t.name.split('-')[1]).join('、');
            const message = `📅 [每日回報] ${new Date().toLocaleDateString()}\n目前無新上架物件。\n機器人運作正常 ✅\n(監控區域: ${targetNames})`;

            for (const userId of subscribedUsers) {
                await lineClient.pushMessage({
                    to: userId,
                    messages: [{ type: 'text', text: message }]
                });
            }
        }

        isCrawling = false;
        return {
            status: 'success',
            count: listings.length,
            newCount: newListings.length
        };

    } catch (error) {
        console.error('爬蟲任務失敗:', error);
        isCrawling = false;

        // 發生錯誤時通知管理員
        try {
            await lineClient.broadcast({
                messages: [{ type: 'text', text: `⚠️ 爬蟲發生錯誤: ${error.message}` }]
            });
        } catch (e) {
            console.error('發送錯誤通知失敗:', e);
        }

        return { status: 'error', error: error.message };
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

// Keep-Alive 端點（給 UptimeRobot 等服務使用）
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// 手動觸發爬蟲
app.get('/crawl', async (req, res) => {
    res.json({ message: '爬蟲任務已啟動' });
    runCrawlTask(true);
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
                        if (lowerText === '指令' || lowerText === '說明' || lowerText === 'help' || lowerText === '/h') {
                            await replyText(event.replyToken,
                                `🤖 591 租屋小幫手 - 完整使用說明

📌【資料來源與去向】
• 來源: 591 租屋網 (台北/新北)
• 儲存: 自動整理至 Google Sheets
   (連結: https://docs.google.com/spreadsheets/d/14-Mm8kSIHevPCJwI6I8wyWHnc9_gtyu3tqCRvoGtxH0/edit#gid=0)

🔎【目前篩選條件】
• 地區: 中正區、中山區、大同區、永和區 (預設)
• 租金: ${SEARCH_CONFIG.minRent}-${SEARCH_CONFIG.maxRent} (可自訂)
• 固定條件: 近捷運、可開伙、乾濕分離
• 排序: 取最新的 20 筆資料

🔔【通知機制】
• 有新物件: 傳送圖文卡片
• 無新物件: 發送「今日無新物件」通知\n(監控: 中正/中山/大同/永和)

🔍【新舊判斷】
• 依據「591物件ID」判斷
• 只要 Sheets 裡面沒有的 ID 就視為新物件

🎮【指令操作】
1️⃣ 輸入「搜尋」→ 立即爬取 (手動強制檢查)
2️⃣ 輸入「狀態」→ 看目前設定
3️⃣ 輸入「地區 [名稱]」
   • 「地區 中山」 (只搜中山)
   • 「地區 淡水」 (只搜淡水)
   • 「地區 中山 永和」 (同时搜多區)
   • 「地區 預設」 (回歸預設四區)
   • 「地區 台北/新北/全」 (大範圍)
4️⃣ 輸入「租金 8000-15000」

🔘【按鈕功能】
• 📘 查看: 開啟 591 網頁
• 📗 有興趣: 存入 Sheets 並標記 ⭐

👨‍💻 開發者: Nick
🔧 系統狀態: 託管於 Render (自動除錯紀錄)`);
                        }
                        // 查看狀態
                        else if (lowerText === '狀態' || lowerText === 'status') {
                            const targetAreas = SEARCH_CONFIG.targets.map(t => t.name).join('、');
                            await replyText(event.replyToken,
                                `📊 目前設定：

💰 租金範圍：${SEARCH_CONFIG.minRent.toLocaleString()} - ${SEARCH_CONFIG.maxRent.toLocaleString()} 元
🏙️ 搜尋地區：${targetAreas}
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
                            const fullArgs = text.replace('地區', '').trim();

                            if (fullArgs === '') {
                                return replyText(event.replyToken, '❓ 請輸入地區名稱，例如：「地區 中山」、「地區 淡水」或「地區 預設」');
                            }

                            const args = fullArgs.split(/\s+/); // 支援多個地區空格分隔
                            let message = '';

                            if (args[0] === '預設') {
                                // 回復預設
                                SEARCH_CONFIG.targets = [
                                    { region: 1, section: 1, name: '台北市-中正區' },
                                    { region: 1, section: 3, name: '台北市-中山區' },
                                    { region: 1, section: 2, name: '台北市-大同區' },
                                    { region: 3, section: 37, name: '新北市-永和區' }
                                ];
                                message = '✅ 已恢復【預設監控區域】：中正、中山、大同、永和';
                            } else if (args[0] === '全' || args[0] === '全部') {
                                // 全區 (台北+新北)
                                SEARCH_CONFIG.targets = [
                                    { region: 1, name: '台北市全區' },
                                    { region: 3, name: '新北市全區' }
                                ];
                                message = '✅ 已切換為【搜尋全台北 + 全新北】';
                            } else if (args[0] === '台北') {
                                SEARCH_CONFIG.targets = [
                                    { region: 1, name: '台北市全區' }
                                ];
                                message = '✅ 已切換為【搜尋全台北市】';
                            } else if (args[0] === '新北') {
                                SEARCH_CONFIG.targets = [
                                    { region: 3, name: '新北市全區' }
                                ];
                                message = '✅ 已切換為【搜尋全新北市】';
                            } else {
                                // 指定特定行政區 (支援多個)
                                // 先引入 map
                                const sectionMap = ScraperConfig.sections;
                                const newTargets = [];
                                const unknownArgs = [];

                                for (const arg of args) {
                                    const cleanArg = arg.replace('區', '') + '區'; // 確保有「區」字
                                    const cleanArgShort = arg.replace('區', ''); // 確保無「區」字 key check

                                    // 嘗試查找 ID (先查全名，再查簡稱)
                                    let sectionId = sectionMap[cleanArg] || sectionMap[cleanArgShort];

                                    if (sectionId) {
                                        // 簡單判斷 region: ID <= 20 為台北(1), > 20 為新北(3)
                                        const regionId = sectionId <= 20 ? 1 : 3;
                                        const regionName = regionId === 1 ? '台北市' : '新北市';
                                        newTargets.push({
                                            region: regionId,
                                            section: sectionId,
                                            name: `${regionName}-${cleanArg}`
                                        });
                                    } else {
                                        unknownArgs.push(arg);
                                    }
                                }

                                if (newTargets.length > 0) {
                                    SEARCH_CONFIG.targets = newTargets;
                                    const names = newTargets.map(t => t.name.split('-')[1]).join('、');
                                    message = `✅ 已設定監控區域：${names}`;
                                    if (unknownArgs.length > 0) {
                                        message += `\n(⚠️ 未知區域：${unknownArgs.join('、')})`;
                                    }
                                } else {
                                    return replyText(event.replyToken, `❌ 找不到區域：${unknownArgs.join(' ')}\n請確認名稱是否正確 (例如：中山、淡水)`);
                                }
                            }

                            console.log('更新監控區域:', SEARCH_CONFIG.targets);
                            return replyText(event.replyToken, message);
                        }
                        // 手動搜尋
                        else if (lowerText.includes('搜尋') || lowerText.includes('找房') || lowerText === '開始') {
                            // 顯示 Loading 動畫
                            await startLoading(event.source.userId, 40);
                            await replyText(event.replyToken, '🔍 正在搜尋中，請稍候...');
                            runCrawlTask();
                        }
                    }
                    break;

                case 'postback':
                    // 使用者點擊按鈕
                    const result = await handlePostback(event);

                    if (result && result.action === 'interested') {
                        // 標記為有興趣 (含聯絡資訊)
                        await markAsInterested(result.id, result.price, result.contactInfo);
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
            console.log(`🏙️ 搜尋地區: ${SEARCH_CONFIG.targets.map(t => t.name).join('、')}`);
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
