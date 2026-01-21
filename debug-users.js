const { initSheets, SPREADSHEET_ID } = require('./sheets');

(async () => {
    try {
        console.log('🔍 檢查原始 Sheet 資料...');
        const sheets = await initSheets();
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Users!A:K'
        });

        const values = response.data.values || [];
        console.log(`總行數: ${values.length}`);

        if (values.length > 0) {
            console.log('Header:', values[0]);
            if (values.length > 1) {
                console.log('第一筆資料:', values[1]);
                console.log('Row[6] (isSubscribed) 值:', values[1][6]);
                console.log('Row[6] 型別:', typeof values[1][6]);
                console.log('是否等於 "TRUE"?', values[1][6] === 'TRUE');
            }
        }
    } catch (e) {
        console.error('❌ 測試失敗:', e);
    }
})();
