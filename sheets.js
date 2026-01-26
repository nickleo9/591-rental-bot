/**
 * Google Sheets 整合模組
 * 負責儲存物件資料和更新狀態
 */

const { google } = require('googleapis');
const fs = require('fs');

// 簡單的互斥鎖 (確保 Sheets 寫入不衝突)
class Mutex {
    constructor() {
        this._queue = [];
        this._locked = false;
    }

    lock() {
        return new Promise((resolve) => {
            if (this._locked) {
                this._queue.push(resolve);
            } else {
                this._locked = true;
                resolve();
            }
        });
    }

    release() {
        if (this._queue.length > 0) {
            const resolve = this._queue.shift();
            resolve();
        } else {
            this._locked = false;
        }
    }
}

const sheetMutex = new Mutex();

// Google Sheets 設定
const CREDENTIALS_PATH = './credentials.json';
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

// 工作表名稱
const SHEETS = {
    ALL_LISTINGS: '所有物件',
    INTERESTED: '有興趣',
    HISTORY: '歷史紀錄'
};

let sheetsClient = null;

/**
 * 初始化 Google Sheets API
 * 使用 Service Account 或 API Key
 */
async function initSheets() {
    if (sheetsClient) return sheetsClient;

    try {
        // 嘗試使用 Service Account
        if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
            const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
            const auth = new google.auth.GoogleAuth({
                credentials,
                scopes: SCOPES
            });
            sheetsClient = google.sheets({ version: 'v4', auth });
        } else {
            // 使用 API Key（只能讀取公開的 Sheets）
            const auth = new google.auth.GoogleAuth({
                scopes: SCOPES
            });
            sheetsClient = google.sheets({ version: 'v4', auth });
        }

        console.log('✅ Google Sheets 連接成功');
        return sheetsClient;
    } catch (error) {
        console.error('❌ Google Sheets 初始化失敗:', error.message);
        throw error;
    }
}

/**
 * 確保工作表存在
 */
async function ensureSheetExists(sheetName) {
    const sheets = await initSheets();

    try {
        // 取得所有工作表
        const response = await sheets.spreadsheets.get({
            spreadsheetId: SPREADSHEET_ID
        });

        const existingSheets = response.data.sheets.map(s => s.properties.title);

        if (!existingSheets.includes(sheetName)) {
            // 建立新工作表
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                requestBody: {
                    requests: [{
                        addSheet: {
                            properties: { title: sheetName }
                        }
                    }]
                }
            });

            // 添加標題列 (新增「圖片」欄位)
            const headers = ['ID', '標題', '租金', '地址', '地區', '捷運', '標籤', '連結', '圖片', '爬取時間', '狀態'];
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!A1:K1`,
                valueInputOption: 'RAW',
                requestBody: { values: [headers] }
            });

            console.log(`✅ 建立工作表: ${sheetName}`);
        }
    } catch (error) {
        console.error(`建立工作表失敗: ${sheetName}`, error.message);
    }
}

/**
 * 儲存物件列表到 Sheets (Thread-Safe)
 */
async function saveListings(listings) {
    await sheetMutex.lock(); // 加鎖

    try {
        const sheets = await initSheets();
        await ensureSheetExists(SHEETS.ALL_LISTINGS);

        // 先取得已存在的 ID
        const existingIds = await getExistingIds();

        // 過濾出新物件
        const newListings = listings.filter(l => !existingIds.has(l.id));

        if (newListings.length === 0) {
            console.log('📭 沒有新物件需要儲存');
            return { saved: 0, new: [] };
        }

        // 準備資料
        const timestamp = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
        const rows = newListings.map(listing => {
            // 取得第一張圖片
            let imageUrl = '';
            if (listing.images && listing.images.length > 0) {
                imageUrl = listing.images[0];
            } else if (listing.image) {
                imageUrl = listing.image;
            }

            return [
                listing.id,
                listing.title,
                listing.price,
                listing.address || '',
                listing.region || '',
                listing.subway || '',
                (listing.tags || []).join(', '),
                listing.url,
                imageUrl, // 新增圖片欄位
                timestamp,
                '新發現'
            ];
        });

        // 附加到工作表
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEETS.ALL_LISTINGS}!A:K`,
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            requestBody: { values: rows }
        });

        console.log(`✅ 儲存了 ${newListings.length} 間新物件`);
        return { saved: newListings.length, new: newListings };

    } finally {
        sheetMutex.release(); // 解鎖
    }
}

/**
 * 取得已存在的物件 ID
 */
async function getExistingIds() {
    const sheets = await initSheets();

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEETS.ALL_LISTINGS}!A:A`
        });

        const values = response.data.values || [];
        return new Set(values.flat().filter(id => id && id !== 'ID'));
    } catch (error) {
        console.log('取得現有 ID 失敗（可能是空表）:', error.message);
        return new Set();
    }
}

/**
 * 標記物件為「有興趣」(含完整資訊)
 * @param {string} listingId - 物件 ID
 * @param {number} price - 租金
 * @param {string} title - 物件標題
 * @param {string} address - 物件地址
 * @param {object} contactInfo - 聯絡資訊 {phone, line, landlordName}
 * @param {string} userId - LINE 用戶 ID
 */
async function markAsInterested(listingId, price, title = '', address = '', contactInfo = {}, userId = '') {
    await sheetMutex.lock(); // 加鎖

    try {
        const sheets = await initSheets();
        await ensureSheetExists(SHEETS.INTERESTED);

        const timestamp = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
        const { phone = '', line = '', landlordName = '' } = contactInfo;

        // 檢查是否已經收藏過
        if (userId) {
            const existingFavorites = await getUserFavorites(userId);
            if (existingFavorites.some(f => f.id === listingId)) {
                console.log(`⚠️ 物件 ${listingId} 已經在用戶 ${userId} 的收藏清單中，跳過重複新增`);
                return 'duplicate';
            }
        }

        // 查找圖片 URL (從主表)
        let imageUrl = '';
        try {
            const listResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEETS.ALL_LISTINGS}!A:I` // I 欄為圖片
            });
            const rows = listResponse.data.values || [];
            const match = rows.find(r => r[0] === listingId);
            if (match && match[8]) {
                imageUrl = match[8];
            }
        } catch (e) {
            console.error('查找圖片失敗:', e.message);
        }

        // 添加到「有興趣」工作表 (包含圖片連結，共 12 欄)
        // 欄位: ID(0), 標題(1), 租金(2), 地址(3), 連結(4), 聯絡人(5), 電話(6), LINE(7), 點擊時間(8), 狀態(9), userId(10), 圖片(11)
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEETS.INTERESTED}!A:L`,
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            requestBody: {
                values: [[
                    listingId,
                    title,
                    price,
                    address,
                    `https://rent.591.com.tw/${listingId}`,
                    landlordName,
                    phone,
                    line,
                    timestamp,
                    '待聯繫',
                    userId,
                    imageUrl // 新增圖片欄位 (Col 12)
                ]]
            }
        });

        // 更新主工作表的狀態
        // Note: calling another locked function from within a lock might cause deadlock if not careful.
        // But here I'm calling updateListingStatus which I will fix.
        // Wait! updateListingStatus ALSO locks. DEADLOCK RISK!
        // Solution: Split logic or make locks reentrant? 
        // My simple Mutex is NOT reentrant.
        // I should inline the update logic OR make a private internal update function without lock.
        // Or simple unlock before calling update? No, that breaks atomicity.
        // Best approach: create a private `_updateListingStatus` without lock, and `updateListingStatus` with lock calling it.
        // For now, to avoid complexity, I will just inline the update logic here or NOT lock the updateListingStatus call since we are holding the lock? 
        // No, `updateListingStatus` is called from OUTSIDE too.
        // So I must separate `_updateStatus` (internal) and `updateListingStatus` (public).

        // I'll implement `_updateListingStatusNoLock` and use it.

        await _updateListingStatusNoLock(sheets, listingId, '有興趣 ⭐');

        console.log(`⭐ 標記物件 ${listingId} 為「有興趣」(用戶: ${userId}, 標題: ${title})`);
        return true;
    } finally {
        sheetMutex.release();
    }
}

/**
 * 內部更新狀態 (不加鎖，供內部調用)
 */
async function _updateListingStatusNoLock(sheets, listingId, status) {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEETS.ALL_LISTINGS}!A:A` // 只要取 ID
        });

        const values = response.data.values || [];
        const rowIndex = values.findIndex(row => row[0] === listingId);

        if (rowIndex > 0) {
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEETS.ALL_LISTINGS}!K${rowIndex + 1}`, // K 欄是狀態
                valueInputOption: 'RAW',
                requestBody: { values: [[status]] }
            });
        }
    } catch (error) {
        console.error('更新狀態失敗:', error.message);
    }
}


/**
 * 更新物件狀態
 */
async function updateListingStatus(listingId, status) {
    await sheetMutex.lock();
    try {
        const sheets = await initSheets();
        await _updateListingStatusNoLock(sheets, listingId, status);
    } finally {
        sheetMutex.release();
    }
}

/**
 * 取得今日新發現的物件
 */
async function getTodayNewListings() {
    const sheets = await initSheets();

    try {
        // 更新讀取範圍到 K
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEETS.ALL_LISTINGS}!A:K`
        });

        const values = response.data.values || [];
        if (values.length <= 1) return [];

        const today = new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' });

        // 過濾今日的物件
        const todayListings = values.slice(1).filter(row => {
            const crawlTime = row[9] || ''; // 索引變為 9
            return crawlTime.includes(today);
        });

        return todayListings.map(row => {
            // 解析租金 (支援 NT$X,XXX 格式)
            let priceStr = String(row[2] || '0');
            let price = parseInt(priceStr.replace(/[^\d]/g, '')) || 0;

            return {
                id: row[0],
                title: row[1],
                price: price,
                address: row[3],
                region: row[4],
                subway: row[5],
                tags: row[6],
                url: row[7],
                image: row[8], // 新增圖片
                status: row[10] // 索引變為 10
            };
        });
    } catch (error) {
        console.error('取得今日物件失敗:', error.message);
        return [];
    }
}

/**
 * 取得過去 N 天的物件
 */
async function getRecentListings(days = 7) {
    const sheets = await initSheets();

    try {
        // 更新讀取範圍到 K
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEETS.ALL_LISTINGS}!A:K`
        });

        const values = response.data.values || [];
        if (values.length <= 1) return [];

        const now = new Date();
        const pastDate = new Date();
        pastDate.setDate(now.getDate() - days);
        pastDate.setHours(0, 0, 0, 0);

        // 過濾過去 N 天的物件
        const recentListings = values.slice(1).filter(row => {
            const crawlTimeStr = row[9] || ''; // 索引變為 9
            // 嘗試解析日期
            try {
                const datePart = crawlTimeStr.split(' ')[0];
                const date = new Date(datePart);
                return date >= pastDate;
            } catch (e) {
                return false;
            }
        });

        return recentListings.map(row => {
            // 解析租金 (支援 NT$X,XXX 格式)
            let priceStr = String(row[2] || '0');
            let price = parseInt(priceStr.replace(/[^\d]/g, '')) || 0;

            return {
                id: row[0],
                title: row[1],
                price: price,
                address: row[3],
                region: row[4],
                subway: row[5],
                tags: row[6],
                url: row[7],
                image: row[8], // 新增圖片
                crawlTime: row[9],
                status: row[10]
            };
        });
    } catch (error) {
        console.error(`取得過去 ${days} 天物件失敗:`, error.message);
        return [];
    }
}

/**
 * 記錄已推播的物件 (避免重複推播)
 * 工作表結構: userId, listingId, pushedAt
 */
async function recordPushedListings(userId, listingIds) {
    const sheets = await initSheets();
    await ensureSheetExists('推播紀錄');

    const timestamp = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
    const rows = listingIds.map(id => [userId, id, timestamp]);

    await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: '推播紀錄!A:C',
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: rows }
    });

    console.log(`📝 記錄 ${listingIds.length} 筆推播紀錄 (用戶: ${userId})`);
}

/**
 * 取得用戶已推播的物件 ID
 */
async function getPushedListingIds(userId) {
    const sheets = await initSheets();

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: '推播紀錄!A:B'
        });

        const values = response.data.values || [];
        const pushedIds = new Set();

        for (const row of values) {
            if (row[0] === userId && row[1]) {
                pushedIds.add(row[1]);
            }
        }

        return pushedIds;
    } catch (error) {
        console.log('取得推播紀錄失敗:', error.message);
        return new Set();
    }
}

/**
 * 取得用戶的收藏清單
 * 工作表結構: ID, 標題, 租金, 地址, 連結, 聯絡人, 電話, LINE, 點擊時間, 狀態, userId
 */
async function getUserFavorites(userId) {
    const sheets = await initSheets();

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEETS.INTERESTED}!A:K`
        });

        const values = response.data.values || [];
        if (values.length <= 1) return [];

        // 過濾該用戶的收藏 (userId 在第 K 欄，索引 10)
        const userFavorites = values.slice(1)
            .filter(row => row[10] === userId)
            .map(row => {
                // 解析租金 (支援 NT$X,XXX 格式)
                let priceStr = String(row[2] || '0');
                let price = parseInt(priceStr.replace(/[NT$,\s]/g, '')) || 0;

                return {
                    id: row[0],
                    title: row[1] || '',
                    price: price,
                    address: row[3] || '',
                    url: row[4] || `https://rent.591.com.tw/${row[0]}`,
                    landlordName: row[5] || '',
                    phone: row[6] || '',
                    line: row[7] || '',
                    clickTime: row[8] || '',
                    status: row[9] || ''
                };
            });

        return userFavorites;
    } catch (error) {
        console.error('取得用戶收藏失敗:', error.message);
        return [];
    }
}

/**
 * 取得過去 7 天內的新物件
 */
async function getWeeklyNewListings() {
    const sheets = await initSheets();

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEETS.ALL_LISTINGS}!A:J`
        });

        const values = response.data.values || [];
        if (values.length <= 1) return [];

        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        oneWeekAgo.setHours(0, 0, 0, 0);

        // 過濾 7 天內的物件
        const weeklyListings = values.slice(1).filter(row => {
            const crawlTimeStr = row[8] || ''; // 2024/1/20 上午 11:32:00
            // 簡單處理日期格式 (假設是 locale string)
            // 如果格式不一致可能會需要更強的解析
            const crawlTime = new Date(crawlTimeStr);
            return crawlTime >= oneWeekAgo;
        });

        return weeklyListings.map(row => ({
            id: row[0],
            title: row[1],
            price: parseInt(row[2]) || 0,
            address: row[3],
            region: row[4],
            subway: row[5],
            tags: row[6],
            url: row[7],
            status: row[9]
        }));
    } catch (error) {
        console.error('取得本週物件失敗:', error.message);
        return [];
    }
}

/**
 * 取得週報所需的完整統計資料
 */
async function getAllListingsForWeekReport() {
    const weeklyListings = await getWeeklyNewListings();

    // 統計數據
    const stats = {
        total: weeklyListings.length,
        byRegion: {},
        minPrice: Infinity,
        maxPrice: 0,
        avgPrice: 0
    };

    if (stats.total === 0) {
        stats.minPrice = 0;
        return { listings: [], stats };
    }

    let totalPrice = 0;

    weeklyListings.forEach(item => {
        // 區域統計
        const region = item.region || '未知';
        stats.byRegion[region] = (stats.byRegion[region] || 0) + 1;

        // 價格統計
        if (item.price > 0) {
            if (item.price < stats.minPrice) stats.minPrice = item.price;
            if (item.price > stats.maxPrice) stats.maxPrice = item.price;
            totalPrice += item.price;
        }
    });

    stats.avgPrice = Math.round(totalPrice / weeklyListings.length);

    // 取熱門/精選物件 (這裡暫時用最新 5 筆當作精選)
    // 未來可以改成點擊數最高的
    const highlights = weeklyListings.slice(0, 5);

    return { listings: highlights, stats };
}

module.exports = {
    initSheets,
    saveListings,
    markAsInterested,
    updateListingStatus,
    getTodayNewListings,
    getRecentListings,
    getExistingIds,
    recordPushedListings,
    getPushedListingIds,
    getUserFavorites,
    getWeeklyNewListings,
    getAllListingsForWeekReport,
    SHEETS
};
