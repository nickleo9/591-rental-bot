/**
 * Google Sheets 整合模組
 * 負責儲存物件資料和更新狀態
 */

const { google } = require('googleapis');

// Google Sheets 設定
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

            // 添加標題列
            const headers = ['ID', '標題', '租金', '地址', '地區', '捷運', '標籤', '連結', '爬取時間', '狀態'];
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${sheetName}!A1:J1`,
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
 * 儲存物件列表到 Sheets
 */
async function saveListings(listings) {
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
    const rows = newListings.map(listing => [
        listing.id,
        listing.title,
        listing.price,
        listing.address || '',
        listing.region || '',
        listing.subway || '',
        (listing.tags || []).join(', '),
        listing.url,
        timestamp,
        '新發現'
    ]);

    // 附加到工作表
    await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEETS.ALL_LISTINGS}!A:J`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: rows }
    });

    console.log(`✅ 儲存了 ${newListings.length} 間新物件`);
    return { saved: newListings.length, new: newListings };
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
 */
async function markAsInterested(listingId, price, title = '', address = '', contactInfo = {}) {
    const sheets = await initSheets();
    await ensureSheetExists(SHEETS.INTERESTED);

    const timestamp = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });
    const { phone = '', line = '', landlordName = '' } = contactInfo;

    // 添加到「有興趣」工作表 (10 欄完整資訊)
    // 欄位: ID, 標題, 租金, 地址, 連結, 聯絡人, 電話, LINE, 點擊時間, 狀態
    await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEETS.INTERESTED}!A:J`,
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
                '待聯繫'
            ]]
        }
    });

    // 更新主工作表的狀態
    await updateListingStatus(listingId, '有興趣 ⭐');

    console.log(`⭐ 標記物件 ${listingId} 為「有興趣」(標題: ${title}, 電話: ${phone})`);
    return true;
}

/**
 * 更新物件狀態
 */
async function updateListingStatus(listingId, status) {
    const sheets = await initSheets();

    try {
        // 查找物件所在的行
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEETS.ALL_LISTINGS}!A:J`
        });

        const values = response.data.values || [];
        const rowIndex = values.findIndex(row => row[0] === listingId);

        if (rowIndex > 0) {
            // 更新狀態欄（第 J 欄，索引 9）
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEETS.ALL_LISTINGS}!J${rowIndex + 1}`,
                valueInputOption: 'RAW',
                requestBody: { values: [[status]] }
            });
        }
    } catch (error) {
        console.error('更新狀態失敗:', error.message);
    }
}

/**
 * 取得今日新發現的物件
 */
async function getTodayNewListings() {
    const sheets = await initSheets();

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEETS.ALL_LISTINGS}!A:J`
        });

        const values = response.data.values || [];
        if (values.length <= 1) return [];

        const today = new Date().toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei' });

        // 過濾今日的物件
        const todayListings = values.slice(1).filter(row => {
            const crawlTime = row[8] || '';
            return crawlTime.includes(today);
        });

        return todayListings.map(row => ({
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
        console.error('取得今日物件失敗:', error.message);
        return [];
    }
}

module.exports = {
    initSheets,
    saveListings,
    markAsInterested,
    updateListingStatus,
    getTodayNewListings,
    getExistingIds,
    SHEETS
};
