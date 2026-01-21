require('dotenv').config();
const { getAllSubscribedUsers, updateUserSettings, SECTIONS } = require('../users');

async function migrate() {
    console.log('🚀 開始遷移用戶設定 (修正新北地區 ID)...');

    // Get all users (subscribed ones mainly, but logic in users.js gets all rows effectively if I used a different function)
    // getAllSubscribedUsers only gets subscribed. I should fix ALL users if possible.
    // But users.js doesn't export getAllUsers.
    // I will use getAllSubscribedUsers for now as they are the active ones.
    // Or I can add a getAllUsers function or just use the google sheets client directly here?
    // Let's rely on users.js exports.

    const users = await getAllSubscribedUsers();
    console.log(`📋 找到 ${users.length} 位訂閱用戶`);

    for (const user of users) {
        if (!user.targets) continue;

        let targets = [];
        try {
            targets = JSON.parse(user.targets);
        } catch (e) {
            console.error(`解析用戶 ${user.userId} targets 失敗`, e);
            continue;
        }

        let changed = false;
        const newTargets = targets.map(t => {
            // Only check Region 3 (New Taipei)
            if (t.region === 3 && t.name) {
                const name = t.name.replace('新北市-', '').replace('新北市', '');
                const cleanName = name.endsWith('區') ? name : name + '區';

                // Lookup new ID
                const newId = SECTIONS[cleanName];

                if (newId && newId !== t.section) {
                    console.log(`🔄 用戶 ${user.userId}: ${cleanName} ID 由 ${t.section} 更新為 ${newId}`);
                    t.section = newId;
                    changed = true;
                }
            }
            return t;
        });

        if (changed) {
            await updateUserSettings(user.userId, {
                targets: JSON.stringify(newTargets)
            });
            console.log(`✅ 用戶 ${user.userId} 更新完成`);
        }
    }

    console.log('🎉 遷移完成');
}

migrate().catch(console.error);
