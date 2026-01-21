/**
 * 591 租屋機器人 - GAS Web App
 * 
 * 功能：
 * 1. 顯示用戶的「有興趣」物件清單（依 userId 過濾）
 * 2. 顯示「所有物件」清單（公開）
 * 
 * 部署方式：
 * 1. 在 Google Sheets 中：擴充功能 → Apps Script
 * 2. 貼上此程式碼
 * 3. 部署 → 新增部署 → 網頁應用程式
 * 4. 執行身分：我 / 存取權限：任何人
 */

const SPREADSHEET_ID = '14-Mm8kSIHevPCJwI6I8wyWHnc9_gtyu3tqCRvoGtxH0';
const SHEET_ALL_LISTINGS = '所有物件';
const SHEET_INTERESTED = '有興趣';

/**
 * 處理 GET 請求
 */
function doGet(e) {
  const userId = e.parameter.userId || '';
  const view = e.parameter.view || 'favorites'; // 'favorites' 或 'all'
  
  let html;
  
  if (view === 'all') {
    // 顯示所有物件（公開）
    html = getAllListingsHtml();
  } else {
    // 顯示用戶收藏（需要 userId）
    if (!userId) {
      html = getErrorHtml('請提供 userId 參數');
    } else {
      html = getFavoritesHtml(userId);
    }
  }
  
  return HtmlService.createHtmlOutput(html)
    .setTitle('591 租屋小幫手')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * 取得用戶收藏的 HTML
 */
function getFavoritesHtml(userId) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_INTERESTED);
  
  if (!sheet) {
    return getErrorHtml('找不到「有興趣」工作表');
  }
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  // 找到 userId 欄位的索引（假設是最後一欄，索引 10）
  const userIdIndex = 10;
  
  // 過濾該用戶的資料
  const userFavorites = data.slice(1).filter(row => row[userIdIndex] === userId);
  
  if (userFavorites.length === 0) {
    return getEmptyHtml('您還沒有收藏任何物件', '回到 LINE 輸入「搜尋」開始找房吧！');
  }
  
  // 建立 HTML
  let html = getHtmlHeader('我的收藏清單', `共 ${userFavorites.length} 筆`);
  
  userFavorites.forEach((row, index) => {
    const id = row[0];
    const title = row[1] || '無標題';
    const price = row[2] || '未知';
    const address = row[3] || '';
    const url = row[4] || `https://rent.591.com.tw/${id}`;
    const landlord = row[5] || '';
    const phone = row[6] || '';
    const line = row[7] || '';
    const clickTime = row[8] || '';
    const status = row[9] || '';
    
    html += `
      <div class="card">
        <div class="card-header">
          <span class="card-title">${escapeHtml(title)}</span>
          <span class="card-price">💰 ${escapeHtml(String(price))} 元</span>
        </div>
        <div class="card-body">
          ${address ? `<p>📍 ${escapeHtml(address)}</p>` : ''}
          ${landlord ? `<p>👤 ${escapeHtml(landlord)}</p>` : ''}
          ${phone ? `<p>📞 ${escapeHtml(phone)}</p>` : ''}
          ${line ? `<p>💬 LINE: ${escapeHtml(line)}</p>` : ''}
          ${status ? `<p>📌 ${escapeHtml(status)}</p>` : ''}
          ${clickTime ? `<p class="time">⏰ 收藏於 ${escapeHtml(clickTime)}</p>` : ''}
        </div>
        <div class="card-footer">
          <a href="${escapeHtml(url)}" target="_blank" class="btn">查看 591 原始頁面</a>
        </div>
      </div>
    `;
  });
  
  html += getHtmlFooter();
  return html;
}

/**
 * 取得所有物件的 HTML
 */
function getAllListingsHtml() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_ALL_LISTINGS);
  
  if (!sheet) {
    return getErrorHtml('找不到「所有物件」工作表');
  }
  
  const data = sheet.getDataRange().getValues();
  const listings = data.slice(1).slice(-50); // 只取最新 50 筆
  
  if (listings.length === 0) {
    return getEmptyHtml('目前沒有物件資料', '請稍後再試');
  }
  
  let html = getHtmlHeader('所有物件', `顯示最新 ${listings.length} 筆`);
  
  listings.reverse().forEach((row, index) => {
    const id = row[0];
    const title = row[1] || '無標題';
    const price = row[2] || '未知';
    const area = row[3] || '';
    const address = row[4] || '';
    const url = row[5] || `https://rent.591.com.tw/${id}`;
    
    html += `
      <div class="card">
        <div class="card-header">
          <span class="card-title">${escapeHtml(title)}</span>
          <span class="card-price">💰 ${escapeHtml(String(price))} 元</span>
        </div>
        <div class="card-body">
          ${area ? `<p>📐 ${escapeHtml(String(area))} 坪</p>` : ''}
          ${address ? `<p>📍 ${escapeHtml(address)}</p>` : ''}
        </div>
        <div class="card-footer">
          <a href="${escapeHtml(url)}" target="_blank" class="btn">查看詳情</a>
        </div>
      </div>
    `;
  });
  
  html += getHtmlFooter();
  return html;
}

/**
 * HTML 頭部
 */
function getHtmlHeader(title, subtitle) {
  return `
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - 591 租屋小幫手</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
    }
    .header {
      text-align: center;
      color: white;
      margin-bottom: 20px;
    }
    .header h1 { font-size: 24px; margin-bottom: 5px; }
    .header p { opacity: 0.8; font-size: 14px; }
    .card {
      background: white;
      border-radius: 12px;
      margin-bottom: 15px;
      overflow: hidden;
      box-shadow: 0 4px 15px rgba(0,0,0,0.1);
    }
    .card-header {
      background: linear-gradient(135deg, #f5f7fa 0%, #e4e8ec 100%);
      padding: 15px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
    }
    .card-title {
      font-weight: 600;
      font-size: 16px;
      color: #333;
      flex: 1;
    }
    .card-price {
      background: #667eea;
      color: white;
      padding: 5px 12px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 500;
    }
    .card-body {
      padding: 15px;
    }
    .card-body p {
      margin-bottom: 8px;
      color: #666;
      font-size: 14px;
    }
    .card-body .time {
      color: #999;
      font-size: 12px;
    }
    .card-footer {
      padding: 15px;
      border-top: 1px solid #eee;
      text-align: center;
    }
    .btn {
      display: inline-block;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 10px 20px;
      border-radius: 25px;
      text-decoration: none;
      font-size: 14px;
      transition: transform 0.2s;
    }
    .btn:hover {
      transform: scale(1.05);
    }
    .empty, .error {
      background: white;
      border-radius: 12px;
      padding: 40px 20px;
      text-align: center;
    }
    .empty h2, .error h2 { color: #333; margin-bottom: 10px; }
    .empty p, .error p { color: #666; }
    .error { background: #fff5f5; }
    .error h2 { color: #e53e3e; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🏠 ${escapeHtml(title)}</h1>
      <p>${escapeHtml(subtitle)}</p>
    </div>
  `;
}

/**
 * HTML 尾部
 */
function getHtmlFooter() {
  return `
  </div>
</body>
</html>
  `;
}

/**
 * 空資料 HTML
 */
function getEmptyHtml(title, message) {
  return getHtmlHeader(title, '') + `
    <div class="empty">
      <h2>📭 ${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
    </div>
  ` + getHtmlFooter();
}

/**
 * 錯誤 HTML
 */
function getErrorHtml(message) {
  return getHtmlHeader('發生錯誤', '') + `
    <div class="error">
      <h2>⚠️ 錯誤</h2>
      <p>${escapeHtml(message)}</p>
    </div>
  ` + getHtmlFooter();
}

/**
 * HTML 跳脫
 */
function escapeHtml(text) {
  if (typeof text !== 'string') return String(text);
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
