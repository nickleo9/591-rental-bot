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
const {
    sendListingsNotification,
    handlePostback,
    client: lineClient,
    startLoading,
    sendWelcomeMessage,
    sendUserSettings,
    sendMyFavorites,
    getUserProfile
} = require('./linebot');
const {
    saveListings,
    markAsInterested,
    initSheets,
    recordPushedListings,
    getPushedListingIds,
    getUserFavorites
} = require('./sheets');
const {
    createUser,
    getUser,
    updateUserSettings,
    getAllSubscribedUsers,
    toggleSubscription,
    parseRegion,
    getSupportedRegions,
    SECTIONS,
    REGION_NAMES
} = require('./users');

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
// 舊版單用戶邏輯已移除，不再預先載入 LINE_USER_ID
// if (process.env.LINE_USER_ID) {
//     subscribedUsers.add(process.env.LINE_USER_ID);
// }

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
 * @param {boolean} manual - 是否為手動觸發
 * @param {string|null} triggeredByUserId - 觸發者的 userId (手動時傳入)
 */
async function runCrawlTask(manual = false, triggeredByUserId = null) {
    if (isCrawling) {
        return { status: 'running', message: '爬蟲正在執行中...' };
    }

    isCrawling = true;
    console.log(`[${new Date().toLocaleString()}] 執行爬蟲任務 (手動: ${manual}, 觸發者: ${triggeredByUserId || '排程'})`);

    // 發送訊息的輔助函數
    const sendMessage = async (message) => {
        if (manual && triggeredByUserId) {
            // 手動觸發：只發給觸發者
            await lineClient.pushMessage({
                to: triggeredByUserId,
                messages: [{ type: 'text', text: message }]
            });
        } else {
            // 排程：廣播給所有人
            await lineClient.broadcast({
                messages: [{ type: 'text', text: message }]
            });
        }
    };

    try {
        // 定義進度回調函數
        const onProgress = async (message) => {
            try {
                await sendMessage(message);
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
        // 決定發送對象
        const targetUsers = (manual && triggeredByUserId) ? [triggeredByUserId] : [...subscribedUsers];

        if (newListings.length > 0) {
            // 有新物件：發送新物件通知
            const message = `🏠 找到 ${newListings.length} 間新物件！\n(篩選條件: ${SEARCH_CONFIG.minRent}-${SEARCH_CONFIG.maxRent}元)`;

            for (const userId of targetUsers) {
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

            const listingsToShow = listings.slice(0, 10);
            for (const userId of targetUsers) {
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

            for (const userId of targetUsers) {
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

/**
 * 為單一用戶執行爬蟲任務（使用用戶個人設定）
 * @param {string} userId - LINE 用戶 ID
 * @param {Array} targets - 搜尋目標陣列
 * @param {number} minRent - 最低租金
 * @param {number} maxRent - 最高租金
 */
async function runCrawlTaskForUser(userId, targets, minRent, maxRent) {
    console.log(`[${new Date().toLocaleString()}] 為用戶 ${userId} 執行爬蟲`);
    console.log(`  目標: ${targets.map(t => t.name).join(', ')}`);
    console.log(`  租金: ${minRent} - ${maxRent}`);

    try {
        // 進度回調
        const onProgress = async (message) => {
            try {
                await lineClient.pushMessage({
                    to: userId,
                    messages: [{ type: 'text', text: message }]
                });
            } catch (e) {
                console.error('發送進度通知失敗:', e);
            }
        };

        // 執行爬蟲
        const { listings, logs } = await scrape591({
            targets: targets,
            minRent: minRent,
            maxRent: maxRent,
            maxResults: 20,
            onProgress
        });

        // 儲存到 Google Sheets
        const { saved, new: newListings } = await saveListings(listings);

        // 發送通知
        if (newListings.length > 0) {
            const message = `🏠 找到 ${newListings.length} 間新物件！\n(篩選條件: ${minRent.toLocaleString()}-${maxRent.toLocaleString()}元)`;
            await lineClient.pushMessage({
                to: userId,
                messages: [{ type: 'text', text: message }]
            });
            await sendListingsNotification(userId, newListings);
        } else if (listings.length > 0) {
            const targetNames = targets.map(t => t.name.split('-')[1] || t.name).join('、');
            const message = `📋 沒有新物件，列出資料庫中的 ${Math.min(listings.length, 10)} 間：\n(地區: ${targetNames})`;
            await lineClient.pushMessage({
                to: userId,
                messages: [{ type: 'text', text: message }]
            });
            await sendListingsNotification(userId, listings.slice(0, 10));
        } else {
            await lineClient.pushMessage({
                to: userId,
                messages: [{ type: 'text', text: '📭 目前沒有符合條件的物件，請稍後再試或調整條件' }]
            });
        }

        console.log(`✅ 用戶 ${userId} 爬蟲完成，找到 ${listings.length} 間物件`);

    } catch (error) {
        console.error(`❌ 用戶 ${userId} 爬蟲失敗:`, error);
        try {
            await lineClient.pushMessage({
                to: userId,
                messages: [{ type: 'text', text: `⚠️ 搜尋發生錯誤: ${error.message}` }]
            });
        } catch (e) {
            console.error('發送錯誤通知失敗:', e);
        }
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

            // 記錄使用者 ID 並確保用戶存在於 Sheets
            if (event.source && event.source.userId) {
                const userId = event.source.userId;
                if (!subscribedUsers.has(userId)) {
                    subscribedUsers.add(userId);
                    console.log(`👤 新增訂閱用戶: ${userId}`);

                    // 嘗試取得用戶資料並建立/更新用戶設定
                    try {
                        console.log(`🔍 正在嘗試取得用戶 ${userId} 的資料...`);
                        const profile = await getUserProfile(userId);
                        console.log(`👤 取得用戶資料結果:`, profile ? JSON.stringify(profile) : 'null');

                        const displayName = profile?.displayName || '';
                        const existingUser = await getUser(userId);

                        if (!existingUser) {
                            console.log(`🆕 用戶不存在，準備建立新用戶 (名稱: ${displayName})`);
                            await createUser(userId, displayName);
                        } else if (!existingUser.displayName && displayName) {
                            console.log(`✏️ 用戶已存在但無名稱，準備更新 (名稱: ${displayName})`);
                            await updateUserSettings(userId, { displayName });
                        } else {
                            console.log(`✅ 用戶已存在且有名稱 (${existingUser.displayName})，無需更新`);
                        }
                    } catch (e) {
                        console.log('取得用戶資料失敗:', e.message);
                        console.error(e);
                    }
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
                        // 查看設定 (個人化)
                        else if (lowerText === '設定' || lowerText === '狀態' || lowerText === 'status') {
                            await startLoading(event.source.userId, 10);
                            const user = await getUser(event.source.userId) || await createUser(event.source.userId);
                            await sendUserSettings(event.source.userId, user, event.replyToken);
                        }
                        // 我的收藏
                        else if (lowerText.includes('收藏') || lowerText.includes('有興趣') || lowerText === 'favorites') {
                            await startLoading(event.source.userId, 15);
                            const favorites = await getUserFavorites(event.source.userId);
                            await sendMyFavorites(event.source.userId, favorites, event.replyToken);
                        }
                        // 暫停推播
                        else if (lowerText === '暫停' || lowerText === 'pause' || lowerText === 'stop') {
                            await toggleSubscription(event.source.userId, false);
                            await replyText(event.replyToken, '🔕 已暫停每日推播\n\n輸入「恢復」重新開啟');
                        }
                        // 恢復推播
                        else if (lowerText === '恢復' || lowerText === 'resume' || lowerText === 'start') {
                            await toggleSubscription(event.source.userId, true);
                            await replyText(event.replyToken, '🔔 已恢復每日推播\n\n每天 11:00 會推播符合你條件的新物件');
                        }
                        // 設定關鍵字
                        else if (text.startsWith('關鍵字')) {
                            const keyword = text.replace('關鍵字', '').trim();
                            await updateUserSettings(event.source.userId, { keywords: keyword });
                            if (keyword) {
                                await replyText(event.replyToken, `✅ 搜尋關鍵字已設定為「${keyword}」\n\n輸入「搜尋」立即查找`);
                            } else {
                                await replyText(event.replyToken, '✅ 已清除搜尋關鍵字');
                            }
                        }
                        // 調整租金 (儲存到用戶設定)
                        else if (text.startsWith('租金')) {
                            const match = text.match(/(\d+)[^\d]+(\d+)/);
                            if (match) {
                                const min = parseInt(match[1]);
                                const max = parseInt(match[2]);
                                if (min < max && min >= 1000 && max <= 100000) {
                                    // 儲存到用戶個人設定
                                    await updateUserSettings(event.source.userId, {
                                        minRent: min,
                                        maxRent: max
                                    });
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
                        // 調整地區 (儲存到用戶設定)
                        else if (text.startsWith('地區')) {
                            const fullArgs = text.replace('地區', '').trim();

                            if (fullArgs === '') {
                                return replyText(event.replyToken, '❓ 請輸入地區名稱，例如：「地區 中山」、「地區 淡水」或「地區 預設」');
                            }

                            const args = fullArgs.split(/\s+/);
                            let message = '';
                            let newTargets = [];

                            if (args[0] === '預設') {
                                newTargets = [
                                    { region: 1, section: 1, name: '台北市-中正區' },
                                    { region: 1, section: 3, name: '台北市-中山區' },
                                    { region: 1, section: 2, name: '台北市-大同區' },
                                    { region: 3, section: 37, name: '新北市-永和區' }
                                ];
                                message = '✅ 已恢復【預設監控區域】：中正、中山、大同、永和';
                            } else if (args[0] === '全' || args[0] === '全部') {
                                newTargets = [
                                    { region: 1, name: '台北市全區' },
                                    { region: 3, name: '新北市全區' }
                                ];
                                message = '✅ 已切換為【搜尋全台北 + 全新北】';
                            } else if (args[0] === '台北') {
                                newTargets = [{ region: 1, name: '台北市全區' }];
                                message = '✅ 已切換為【搜尋全台北市】';
                            } else if (args[0] === '新北') {
                                newTargets = [{ region: 3, name: '新北市全區' }];
                                message = '✅ 已切換為【搜尋全新北市】';
                            } else {
                                // 指定特定行政區
                                const sectionMap = ScraperConfig.sections;
                                const unknownArgs = [];

                                for (const arg of args) {
                                    const cleanArg = arg.replace('區', '') + '區';
                                    const cleanArgShort = arg.replace('區', '');
                                    let sectionId = sectionMap[cleanArg] || sectionMap[cleanArgShort];

                                    if (sectionId) {
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
                                    const names = newTargets.map(t => t.name.split('-')[1]).join('、');
                                    message = `✅ 已設定監控區域：${names}`;
                                    if (unknownArgs.length > 0) {
                                        message += `\n(⚠️ 未知區域：${unknownArgs.join('、')})`;
                                    }
                                } else {
                                    return replyText(event.replyToken, `❌ 找不到區域：${unknownArgs.join(' ')}\n請確認名稱是否正確 (例如：中山、淡水)`);
                                }
                            }

                            // 儲存到用戶設定 (使用 JSON 字串儲存 targets)
                            // region 欄位儲存簡易顯示名稱
                            const regionDisplay = newTargets.map(t => t.name.split('-')[1] || t.name).join('、');
                            await updateUserSettings(event.source.userId, {
                                targets: JSON.stringify(newTargets),
                                region: regionDisplay || '台北市'
                            });

                            console.log(`用戶 ${event.source.userId} 更新監控區域:`, newTargets);
                            return replyText(event.replyToken, message);
                        }
                        // 手動搜尋 (使用用戶個人設定)
                        else if (lowerText.includes('搜尋') || lowerText.includes('找房') || lowerText === '開始') {
                            await startLoading(event.source.userId, 40);

                            // 讀取用戶設定
                            const user = await getUser(event.source.userId);
                            console.log('📋 用戶設定:', user ? JSON.stringify({
                                region: user.region,
                                minRent: user.minRent,
                                maxRent: user.maxRent,
                                targets: user.targets ? '有設定' : '空'
                            }) : '用戶不存在');

                            let userTargets = SEARCH_CONFIG.targets; // 預設
                            let userMinRent = SEARCH_CONFIG.minRent;
                            let userMaxRent = SEARCH_CONFIG.maxRent;

                            if (user) {
                                userMinRent = user.minRent || SEARCH_CONFIG.minRent;
                                userMaxRent = user.maxRent || SEARCH_CONFIG.maxRent;

                                // 嘗試解析 targets JSON
                                if (user.targets) {
                                    try {
                                        userTargets = JSON.parse(user.targets);
                                        console.log('✅ 解析 targets 成功:', userTargets);
                                    } catch (e) {
                                        console.log('❌ 解析 targets 失敗，使用預設:', e.message);
                                    }
                                } else {
                                    console.log('⚠️ 用戶 targets 為空，使用預設');
                                }
                            }

                            const targetNames = userTargets.map(t => t.name.split('-')[1] || t.name).join('、');
                            await replyText(event.replyToken, `🔍 正在搜尋中...

📍 地區：${targetNames}
💰 租金：${userMinRent.toLocaleString()} - ${userMaxRent.toLocaleString()} 元`);

                            // 使用用戶設定執行爬蟲
                            runCrawlTaskForUser(event.source.userId, userTargets, userMinRent, userMaxRent);
                        }
                    }
                    break;

                case 'postback':
                    // 使用者點擊按鈕
                    const result = await handlePostback(event);

                    if (result && result.action === 'interested') {
                        // 標記為有興趣 (含完整資訊 + userId)
                        await markAsInterested(
                            result.id,
                            result.price,
                            result.title,
                            result.address,
                            result.contactInfo,
                            event.source.userId
                        );
                    }
                    break;

                case 'follow':
                    // 新用戶加入好友
                    console.log('🎉 新用戶加入:', event.source.userId);
                    const profile = await getUserProfile(event.source.userId);
                    const displayName = profile?.displayName || '';
                    await createUser(event.source.userId, displayName);
                    await sendWelcomeMessage(event.source.userId, displayName);
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
