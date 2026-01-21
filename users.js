/**
 * 用戶管理模組
 * 負責用戶設定的 CRUD 操作
 */

const { google } = require('googleapis');

// Google Sheets 設定
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SHEET_NAME = '用戶設定';

// 支援的縣市對照表
const REGIONS = {
    '台北': 1, '台北市': 1,
    '新北': 3, '新北市': 3,
    '基隆': 4, '基隆市': 4,
    '桃園': 5, '桃園市': 5,
    '新竹市': 6,
    '新竹縣': 7,
    '新竹': 6,
    '苗栗': 8, '苗栗縣': 8,
    '台中': 10, '台中市': 10,
    '彰化': 11, '彰化縣': 11,
    '南投': 12, '南投縣': 12,
    '雲林': 13, '雲林縣': 13,
    '嘉義市': 14,
    '嘉義縣': 15,
    '嘉義': 14,
    '台南': 17, '台南市': 17,
    '高雄': 19, '高雄市': 19,
    '屏東': 21, '屏東縣': 21,
    '宜蘭': 22, '宜蘭縣': 22,
    '花蓮': 23, '花蓮縣': 23,
    '台東': 24, '台東縣': 24
};

// 地區代碼轉名稱
const REGION_NAMES = {
    1: '台北市',
    3: '新北市',
    4: '基隆市',
    5: '桃園市',
    6: '新竹市',
    7: '新竹縣',
    8: '苗栗縣',
    10: '台中市',
    11: '彰化縣',
    12: '南投縣',
    13: '雲林縣',
    14: '嘉義市',
    15: '嘉義縣',
    17: '台南市',
    19: '高雄市',
    21: '屏東縣',
    22: '宜蘭縣',
    23: '花蓮縣',
    24: '台東縣'
};

// 行政區對照表 (台北/新北)
const SECTIONS = {
    // 台北市 (Region 1)
    '中正區': 1, '中正': 1,
    '大同區': 2, '大同': 2,
    '中山區': 3, '中山': 3,
    '松山區': 4, '松山': 4,
    '大安區': 5, '大安': 5,
    '萬華區': 6, '萬華': 6,
    '信義區': 7, '信義': 7,
    '士林區': 8, '士林': 8,
    '北投區': 9, '北投': 9,
    '內湖區': 10, '內湖': 10,
    '南港區': 11, '南港': 11,
    '文山區': 12, '文山': 12,

    // 新北市 (Region 3)
    '板橋區': 26, '板橋': 26,
    '三重區': 27, '三重': 27,
    '中和區': 29, '中和': 29,
    '永和區': 37, '永和': 37,
    '新莊區': 30, '新莊': 30,
    '新店區': 32, '新店': 32,
    '淡水區': 39, '淡水': 39,
    '土城區': 33, '土城': 33,
    '蘆洲區': 28, '蘆洲': 28,
    '汐止區': 31, '汐止': 31,
    '樹林區': 34, '樹林': 34,
    '鶯歌區': 35, '鶯歌': 35,
    '三峽區': 36, '三峽': 36,
    '林口區': 38, '林口': 38,
    '五股區': 40, '五股': 40,
    '泰山區': 41, '泰山': 41,
    '八里區': 42, '八里': 42,
    '瑞芳區': 43, '瑞芳': 43,
    '深坑區': 44, '深坑': 44,
    '石碇區': 45, '石碇': 45,
    '坪林區': 46, '坪林': 46,
    '平溪區': 47, '平溪': 47,
    '雙溪區': 48, '雙溪': 48,
    '貢寮區': 49, '貢寮': 49,
    '金山區': 50, '金山': 50,
    '萬里區': 51, '萬里': 51,
    '烏來區': 52, '烏來': 52
};

// 預設用戶設定
const DEFAULT_SETTINGS = {
    region: '台北市',
    regionCode: 1,
    minRent: 8000,
    maxRent: 15000,
    keywords: '',
    subscribed: true
};

let sheetsClient = null;

/**
 * 初始化 Sheets 客戶端
 */
async function initSheets() {
    if (sheetsClient) return sheetsClient;

    try {
        if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
            const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
            const auth = new google.auth.GoogleAuth({
                credentials,
                scopes: ['https://www.googleapis.com/auth/spreadsheets']
            });
            sheetsClient = google.sheets({ version: 'v4', auth });
        } else {
            const auth = new google.auth.GoogleAuth({
                scopes: ['https://www.googleapis.com/auth/spreadsheets']
            });
            sheetsClient = google.sheets({ version: 'v4', auth });
        }
        return sheetsClient;
    } catch (error) {
        console.error('❌ Sheets 初始化失敗:', error.message);
        throw error;
    }
}

/**
 * 確保用戶設定工作表存在，且標題列包含 targets 欄位
 */
async function ensureUserSheet() {
    const sheets = await initSheets();
    const headers = ['userId', 'displayName', 'region', 'regionCode', 'minRent', 'maxRent', 'keywords', 'subscribed', 'createdAt', 'updatedAt', 'targets'];

    try {
        const response = await sheets.spreadsheets.get({
            spreadsheetId: SPREADSHEET_ID
        });

        const existingSheets = response.data.sheets.map(s => s.properties.title);

        if (!existingSheets.includes(SHEET_NAME)) {
            // 工作表不存在，建立新的
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                requestBody: {
                    requests: [{
                        addSheet: {
                            properties: { title: SHEET_NAME }
                        }
                    }]
                }
            });

            // 添加標題列 (11 欄: 含 targets)
            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A1:K1`,
                valueInputOption: 'RAW',
                requestBody: { values: [headers] }
            });

            console.log(`✅ 建立用戶設定工作表`);
        } else {
            // 工作表已存在，檢查標題列是否包含 targets
            const headerResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A1:K1`
            });

            const currentHeaders = headerResponse.data.values?.[0] || [];

            // 如果標題列少於 11 欄或沒有 targets，則更新標題列
            if (currentHeaders.length < 11 || !currentHeaders.includes('targets')) {
                await sheets.spreadsheets.values.update({
                    spreadsheetId: SPREADSHEET_ID,
                    range: `${SHEET_NAME}!A1:K1`,
                    valueInputOption: 'RAW',
                    requestBody: { values: [headers] }
                });
                console.log(`✅ 更新用戶設定工作表標題列 (新增 targets 欄位)`);
            }
        }
    } catch (error) {
        console.error('建立/更新用戶表失敗:', error.message);
    }
}

/**
 * 建立新用戶
 */
async function createUser(userId, displayName = '') {
    const sheets = await initSheets();
    await ensureUserSheet();

    // 檢查用戶是否已存在
    const existing = await getUser(userId);
    if (existing) {
        console.log(`👤 用戶已存在: ${userId}`);
        return existing;
    }

    const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });

    const userData = [
        userId,
        displayName,
        DEFAULT_SETTINGS.region,
        DEFAULT_SETTINGS.regionCode,
        DEFAULT_SETTINGS.minRent,
        DEFAULT_SETTINGS.maxRent,
        DEFAULT_SETTINGS.keywords,
        'TRUE',
        now,
        now,
        '' // targets 初始為空
    ];

    console.log(`📝 準備寫入新用戶資料:`, JSON.stringify(userData));

    await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A:K`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [userData] }
    });

    console.log(`✅ 新用戶已建立: ${displayName || userId}`);

    return {
        userId,
        displayName,
        ...DEFAULT_SETTINGS
    };
}

/**
 * 取得用戶設定
 */
async function getUser(userId) {
    const sheets = await initSheets();
    await ensureUserSheet();

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:K`
        });

        const values = response.data.values || [];
        if (values.length <= 1) return null;

        const row = values.find(r => r[0] === userId);
        if (!row) return null;

        return {
            userId: row[0],
            displayName: row[1] || '',
            region: row[2] || DEFAULT_SETTINGS.region,
            regionCode: parseInt(row[3]) || DEFAULT_SETTINGS.regionCode,
            minRent: parseInt(row[4]) || DEFAULT_SETTINGS.minRent,
            maxRent: parseInt(row[5]) || DEFAULT_SETTINGS.maxRent,
            keywords: row[6] || '',
            subscribed: row[7] === 'TRUE',
            createdAt: row[8],
            updatedAt: row[9],
            targets: row[10] || '' // targets JSON 字串
        };
    } catch (error) {
        console.error('取得用戶失敗:', error.message);
        return null;
    }
}

/**
 * 更新用戶設定
 */
async function updateUserSettings(userId, settings) {
    const sheets = await initSheets();

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:K`
        });

        const values = response.data.values || [];
        const rowIndex = values.findIndex(r => r[0] === userId);

        if (rowIndex <= 0) {
            console.log('用戶不存在，無法更新');
            return null;
        }

        const currentRow = values[rowIndex];
        const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' });

        // 合併現有設定和新設定
        console.log(`📝 準備更新用戶 ${userId}, 設定:`, JSON.stringify(settings));

        const updatedRow = [
            userId,
            settings.displayName ?? currentRow[1],
            settings.region ?? currentRow[2],
            settings.regionCode ?? currentRow[3],
            settings.minRent ?? currentRow[4],
            settings.maxRent ?? currentRow[5],
            settings.keywords ?? currentRow[6],
            settings.subscribed !== undefined ? (settings.subscribed ? 'TRUE' : 'FALSE') : currentRow[7],
            currentRow[8], // createdAt 不變
            now, // updatedAt 更新
            settings.targets ?? currentRow[10] ?? '' // targets JSON
        ];

        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A${rowIndex + 1}:K${rowIndex + 1}`,
            valueInputOption: 'RAW',
            requestBody: { values: [updatedRow] }
        });

        console.log(`✅ 用戶設定已更新: ${userId}`);

        return {
            userId,
            displayName: updatedRow[1],
            region: updatedRow[2],
            regionCode: parseInt(updatedRow[3]),
            minRent: parseInt(updatedRow[4]),
            maxRent: parseInt(updatedRow[5]),
            keywords: updatedRow[6],
            subscribed: updatedRow[7] === 'TRUE'
        };
    } catch (error) {
        console.error('更新用戶失敗:', error.message);
        return null;
    }
}

/**
 * 取得所有訂閱中的用戶
 */
async function getAllSubscribedUsers() {
    const sheets = await initSheets();
    await ensureUserSheet();

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:K`
        });

        const values = response.data.values || [];
        if (values.length <= 1) return [];

        return values.slice(1)
            .filter(row => String(row[7]).toUpperCase() !== 'FALSE') // subscribed default TRUE (unless 'FALSE')
            .map(row => ({
                userId: row[0],
                displayName: row[1] || '',
                region: row[2] || DEFAULT_SETTINGS.region,
                regionCode: parseInt(row[3]) || DEFAULT_SETTINGS.regionCode,
                minRent: parseInt(row[4]) || DEFAULT_SETTINGS.minRent,
                maxRent: parseInt(row[5]) || DEFAULT_SETTINGS.maxRent,
                keywords: row[6] || '',
                subscribed: true,
                targets: row[10] || '' // targets JSON string
            }));
    } catch (error) {
        console.error('取得訂閱用戶失敗:', error.message);
        return [];
    }
}

/**
 * 切換訂閱狀態
 */
async function toggleSubscription(userId, subscribed) {
    return await updateUserSettings(userId, { subscribed });
}

/**
 * 解析地區名稱 (支援縣市 + 行政區)
 * @returns {{ region: string, regionCode: number, section?: number, sectionName?: string } | null}
 */
function parseRegion(text) {
    const cleanText = text.trim().replace('區', '') + '區';
    const cleanTextShort = text.trim().replace('區', '');

    // 先檢查是否為行政區 (台北/新北)
    const sectionId = SECTIONS[cleanText] || SECTIONS[cleanTextShort];
    if (sectionId) {
        // 判斷屬於台北還是新北
        const regionCode = sectionId <= 20 ? 1 : 3;
        const regionName = regionCode === 1 ? '台北市' : '新北市';
        return {
            region: regionName,
            regionCode: regionCode,
            section: sectionId,
            sectionName: cleanText.endsWith('區') ? cleanText : cleanText + '區'
        };
    }

    // 再檢查是否為縣市
    const cityText = text.trim();
    if (REGIONS[cityText]) {
        return {
            region: REGION_NAMES[REGIONS[cityText]],
            regionCode: REGIONS[cityText]
        };
    }

    // 模糊匹配
    for (const [name, code] of Object.entries(REGIONS)) {
        if (cityText.includes(name) || name.includes(cityText)) {
            return {
                region: REGION_NAMES[code],
                regionCode: code
            };
        }
    }

    return null;
}

/**
 * 取得所有支援的縣市列表
 */
function getSupportedRegions() {
    return Object.values(REGION_NAMES);
}

/**
 * 取得所有支援的行政區列表 (台北+新北)
 */
function getSupportedSections() {
    const sections = [];
    for (const [name, id] of Object.entries(SECTIONS)) {
        if (name.endsWith('區')) {
            sections.push(name);
        }
    }
    return [...new Set(sections)];
}

module.exports = {
    createUser,
    getUser,
    updateUserSettings,
    getAllSubscribedUsers,
    toggleSubscription,
    parseRegion,
    getSupportedRegions,
    getSupportedSections,
    ensureUserSheet,
    REGIONS,
    REGION_NAMES,
    SECTIONS,
    DEFAULT_SETTINGS
};
