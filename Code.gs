/**
 * 591 租屋機器人 - GAS Web App (新版 - 欄位修正 V2)
 */

const SPREADSHEET_ID = '14-Mm8kSIHevPCJwI6I8wyWHnc9_gtyu3tqCRvoGtxH0';
const SHEET_ALL_LISTINGS = '所有物件';
const SHEET_INTERESTED = '有興趣';

// 欄位索引設定 (0-based)
const IDX_INT_ID = 0;
const IDX_INT_TITLE = 1;
const IDX_INT_PRICE = 2;
const IDX_INT_ADDR = 3;
const IDX_INT_URL = 4;
// 5, 6, 7 是 聯絡人/電話/LINE (目前 Web 沒用到)
const IDX_INT_TIME = 8;
const IDX_INT_STATUS = 9;
const IDX_INT_USERID = 10;

/**
 * 處理網頁請求 (doGet)
 */
function doGet(e) {
  // 支援 view 或 page 參數
  const page = e.parameter.view || e.parameter.page || 'all';
  const userId = e.parameter.userId || '';
  
  let template;
  
  // 支援 'favorites' (新版) 或 'fav' (舊版)
  if (page === 'favorites' || page === 'fav') {
    template = HtmlService.createTemplateFromFile('Favorites');
    template.userId = userId;
  } else {
    // 預設頁面
    template = HtmlService.createTemplateFromFile('AllListings');
    template.userId = userId; 
  }

  return template.evaluate()
    .setTitle('591 租屋小幫手')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * [API] 取得資料
 */
function getRentalData(viewMode, userId) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  
  // 1. 先取得該使用者的收藏 ID 清單
  let userFavIds = new Set();
  
  if (userId) {
    const favSheet = ss.getSheetByName(SHEET_INTERESTED);
    if (favSheet) {
      const favData = favSheet.getDataRange().getValues();
      // 跳過標題列，從資料列開始
      for (let i = 1; i < favData.length; i++) {
        const row = favData[i];
        // 檢查 UserID (Col 11, Index 10)
        if (String(row[IDX_INT_USERID]) === String(userId)) {
          userFavIds.add(String(row[IDX_INT_ID]));
        }
      }
    }
  }

  // 模式一：所有物件 (All Listings)
  if (viewMode === 'all') {
    const sheet = ss.getSheetByName(SHEET_ALL_LISTINGS);
    if (!sheet) return [];

    const data = sheet.getDataRange().getValues().slice(1);
    const listings = data.slice(-50).reverse(); // 取最新 50 筆

    return listings.map(row => ({
      id: row[0],
      title: row[1] || '無標題',
      price: row[2],
      address: row[3],      // 地址
      region: row[4],       // 地區
      url: row[7] || `https://rent.591.com.tw/${row[0]}`,  // 連結在 Col 8 (idx 7)
      status: '', // 這邊不顯示全域狀態，避免混淆
      isFavorite: userFavIds.has(String(row[0])) // 判斷是否收藏
    }));
  } 
  
  // 模式二：我的收藏 (My Favorites)
  else {
    if (!userId) throw new Error('請提供 User ID');
    const sheet = ss.getSheetByName(SHEET_INTERESTED);
    if (!sheet) return [];

    const data = sheet.getDataRange().getValues().slice(1);

    // 篩選屬於該 User 的列
    const myFavs = data.filter(row => String(row[IDX_INT_USERID]) === String(userId));

    return myFavs.map(row => ({
      id: row[IDX_INT_ID],
      title: row[IDX_INT_TITLE],
      price: row[IDX_INT_PRICE],
      address: row[IDX_INT_ADDR],
      url: row[IDX_INT_URL],
      landlord: '', 
      status: row[IDX_INT_STATUS] || '', // 顯示「待聯繫」或「有興趣」
      isFavorite: true
    })).reverse();
  }
}

/**
 * [API] 加入我的最愛
 */
function addToFavorites(userId, item) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_INTERESTED);
  
  if (!sheet) throw new Error('找不到「有興趣」工作表');

  // 檢查重複 (ID + UserID)
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[IDX_INT_ID]) === String(item.id) && String(row[IDX_INT_USERID]) === String(userId)) {
      return { success: true, message: '已經在清單中了' };
    }
  }

  // 準備新增的資料列
  // ID, Title, Price, Address, Url, Contact, Phone, Line, Time, Status, UserID
  const newRow = [
    item.id,
    item.title,
    item.price,
    item.address || item.region,
    item.url,
    '', // Contact
    '', // Phone
    '', // Line
    new Date(), // Time
    'WEB_ADD',  // Status
    userId      // UserID (Index 10)
  ];

  sheet.appendRow(newRow);
  return { success: true, message: '已加入收藏！' };
}

/**
 * [API] 移除我的最愛
 */
function removeFromFavorites(userId, itemId) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_INTERESTED);
  
  if (!sheet) throw new Error('找不到「有興趣」工作表');

  const data = sheet.getDataRange().getValues();
  let rowIndex = -1;

  // 搜尋符合的列
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[IDX_INT_ID]) === String(itemId) && String(row[IDX_INT_USERID]) === String(userId)) {
      rowIndex = i + 1; // 轉成 Sheet 的 Row Number (1-based)
      break;
    }
  }

  if (rowIndex > -1) {
    sheet.deleteRow(rowIndex);
    return { success: true, message: '已取消收藏' };
  } else {
    // 找不到可能是已經刪除了，也算成功
    return { success: true, message: '收藏不存在或已刪除' };
  }
}


function debugMyFav() {
  const uid = 'U9ff328ddfb51aeb07b42735de3badc11';
  const res = getRentalData('favorites', uid);
  console.log('Result count:', res.length);
  
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_INTERESTED);
  const data = sheet.getDataRange().getValues().slice(1);
  
  data.forEach((row, i) => {
    if (i < 5) { // 只看前5筆
       console.log(`Row ${i+2}: UserID=[${row[10]}], Match? ${String(row[10]) === uid}`);
    }
  });
}
