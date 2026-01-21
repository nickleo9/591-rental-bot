/**
 * LINE Bot 模組
 * 負責發送通知和處理使用者互動
 */

const { Client, messagingApi, middleware } = require('@line/bot-sdk');
const { getContactInfo } = require('./scraper');

// LINE Bot 設定
const config = {
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN
};

// 建立 LINE API 客戶端
const client = new messagingApi.MessagingApiClient({
    channelAccessToken: config.channelAccessToken
});

/**
 * 顯示 Loading 動畫
 * 讓使用者知道 Bot 正在處理中
 * @param {string} userId - LINE 用戶 ID
 * @param {number} seconds - 顯示秒數 (5-60)
 */
async function startLoading(userId, seconds = 20) {
    try {
        const response = await fetch('https://api.line.me/v2/bot/chat/loading/start', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.channelAccessToken}`
            },
            body: JSON.stringify({
                chatId: userId,
                loadingSeconds: Math.min(Math.max(seconds, 5), 60) // 限制在 5-60 秒
            })
        });

        if (!response.ok) {
            console.error('Loading 動畫啟動失敗:', response.status);
        }
    } catch (error) {
        console.error('Loading 動畫錯誤:', error.message);
    }
}

/**
 * 格式化單一物件訊息 (返回單一 bubble)
 */
function formatListing(listing, index) {
    const priceFormatted = listing.price.toLocaleString();
    // 截短標題 (避免過長)
    const shortTitle = listing.title.length > 25
        ? listing.title.substring(0, 25) + '...'
        : listing.title;

    // 處理圖片 URL (取第一張有效圖片)
    const allImages = listing.images || (listing.image ? [listing.image] : []);
    let heroImage = null;

    for (const url of allImages) {
        if (!url || url.includes('data:') || url.length < 10) continue;
        let processedUrl = url;
        if (processedUrl.startsWith('http://')) {
            processedUrl = processedUrl.replace('http://', 'https://');
        }
        if (processedUrl.startsWith('https://') && processedUrl.length < 2000) {
            heroImage = processedUrl;
            break;
        }
    }

    // 建立 bubble
    const bubble = {
        type: 'bubble',
        size: 'kilo',
        // 只有有效圖片才顯示 hero
        ...(heroImage && {
            hero: {
                type: 'image',
                url: heroImage,
                size: 'full',
                aspectRatio: '16:9',
                aspectMode: 'cover',
                action: {
                    type: 'uri',
                    uri: listing.url
                }
            }
        }),
        header: {
            type: 'box',
            layout: 'vertical',
            contents: [
                {
                    type: 'text',
                    text: `${index + 1}. ${shortTitle}`,
                    weight: 'bold',
                    size: 'md',
                    wrap: true,
                    maxLines: 2
                }
            ],
            backgroundColor: '#F5F5F5'
        },
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                {
                    type: 'box',
                    layout: 'horizontal',
                    contents: [
                        {
                            type: 'text',
                            text: '💰',
                            size: 'sm',
                            flex: 0
                        },
                        {
                            type: 'text',
                            text: `${priceFormatted} 元/月`,
                            size: 'sm',
                            color: '#E74C3C',
                            weight: 'bold',
                            margin: 'sm'
                        }
                    ]
                },
                {
                    type: 'box',
                    layout: 'horizontal',
                    contents: [
                        {
                            type: 'text',
                            text: '📍',
                            size: 'sm',
                            flex: 0
                        },
                        {
                            type: 'text',
                            text: listing.address || listing.region || '未知',
                            size: 'sm',
                            color: '#666666',
                            margin: 'sm',
                            wrap: true,
                            maxLines: 2
                        }
                    ],
                    margin: 'sm'
                },
                {
                    type: 'box',
                    layout: 'horizontal',
                    contents: [
                        {
                            type: 'text',
                            text: '🚇',
                            size: 'sm',
                            flex: 0
                        },
                        {
                            type: 'text',
                            text: listing.subway || '近捷運',
                            size: 'sm',
                            color: '#666666',
                            margin: 'sm',
                            wrap: true
                        }
                    ],
                    margin: 'sm'
                }
            ],
            spacing: 'sm'
        },
        footer: {
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
            contents: [
                {
                    type: 'button',
                    style: 'primary',
                    height: 'sm',
                    action: {
                        type: 'uri',
                        label: '查看',
                        uri: listing.url
                    },
                    color: '#3498DB'
                },
                {
                    type: 'button',
                    style: 'primary',
                    height: 'sm',
                    action: {
                        type: 'postback',
                        label: '有興趣👍',
                        data: `action=interested&id=${listing.id}&price=${listing.price}&title=${encodeURIComponent(listing.title.substring(0, 15))}`
                    },
                    color: '#27AE60'
                }
            ]
        }
    };

    return bubble;
}

/**
 * 發送物件清單通知
 */
async function sendListingsNotification(userId, listings) {
    if (!listings || listings.length === 0) {
        // 沒有新物件
        await client.pushMessage({
            to: userId,
            messages: [{
                type: 'text',
                text: '📭 今日沒有找到新的符合條件的物件，明天再幫你找找！'
            }]
        });
        return;
    }

    // 發送摘要訊息
    await client.pushMessage({
        to: userId,
        messages: [{
            type: 'text',
            text: `🏠 找到 ${listings.length} 間符合條件的房屋！\n\n條件：租金 8,000-12,000 元、近捷運、可開伙、乾濕分離\n地區：台北市、新北市\n\n⬇️ 滑動查看詳情`
        }]
    });

    // 將物件分組（每組最多 10 個，LINE 限制）
    const chunks = [];
    for (let i = 0; i < listings.length; i += 10) {
        chunks.push(listings.slice(i, i + 10));
    }

    // 發送每組物件
    for (const chunk of chunks) {
        // formatListing 現在回傳單一 bubble
        const bubbles = chunk.map((listing, index) => formatListing(listing, index));

        // LINE carousel 限制最多 12 個 bubbles
        const bubblesToSend = bubbles.slice(0, 12);

        await client.pushMessage({
            to: userId,
            messages: [{
                type: 'flex',
                altText: `找到 ${chunk.length} 間房屋`,
                contents: {
                    type: 'carousel',
                    contents: bubblesToSend
                }
            }]
        });

        // 避免發送太快
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`✅ 已發送 ${listings.length} 間物件通知給用戶 ${userId}`);
}

/**
 * 處理 Postback 事件（使用者點擊按鈕）
 */
async function handlePostback(event) {
    const data = new URLSearchParams(event.postback.data);
    const action = data.get('action');

    if (action === 'interested') {
        const id = data.get('id');
        const price = data.get('price');
        const title = data.get('title') || ''; // 取得標題 (可能是截斷的)

        // 先回覆確認訊息 (讓用戶知道正在處理)
        await client.replyMessage({
            replyToken: event.replyToken,
            messages: [{
                type: 'text',
                text: `⏳ 正在為您抓取 ${title ? `「${title}...」` : ''} 聯絡資訊，請稍候...`
            }]
        });

        // 抓取聯絡資訊 (包含標題和地址)
        let contactInfo = { phone: '', line: '', landlordName: '', title: '', address: '' };
        try {
            contactInfo = await getContactInfo(id);
        } catch (e) {
            console.error('抓取聯絡資訊失敗:', e);
        }

        // 組合回覆訊息
        let replyParts = [];

        // 標題
        if (contactInfo.title) {
            replyParts.push(`🏠 ${contactInfo.title}`);
        }

        // 租金
        replyParts.push(`💰 ${parseInt(price).toLocaleString()} 元/月`);

        // 地址
        if (contactInfo.address) {
            replyParts.push(`📍 ${contactInfo.address}`);
        }

        // 聯絡資訊
        replyParts.push(''); // 空行
        if (contactInfo.landlordName) {
            replyParts.push(`👤 聯絡人：${contactInfo.landlordName}`);
        }
        if (contactInfo.phone) {
            replyParts.push(`📞 電話：${contactInfo.phone}`);
        }
        if (contactInfo.line) {
            replyParts.push(`💬 LINE：${contactInfo.line}`);
        }
        if (!contactInfo.phone && !contactInfo.line) {
            replyParts.push('⚠️ 無法取得聯絡方式，請點連結查看');
        }

        // 連結
        replyParts.push('');
        replyParts.push(`🔗 https://rent.591.com.tw/${id}`);

        // 發送詳細訊息 (使用 push 因為 reply token 已用過)
        // await client.pushMessage({ ... }); // 移到 server.js 處理，以便判斷是否重複

        return {
            action: 'interested',
            id,
            price: parseInt(price),
            title: contactInfo.title,
            address: contactInfo.address,
            contactInfo,
            timestamp: new Date().toISOString(),
            replyContent: replyParts.join('\n') // 回傳組合好的訊息內容
        };
    }

    return null;
}

/**
 * LINE Webhook middleware
 */
function lineMiddleware() {
    return middleware(config);
}

/**
 * 取得使用者資料
 */
async function getUserProfile(userId) {
    try {
        const profile = await client.getProfile(userId);
        return profile;
    } catch (e) {
        console.error('取得用戶資料失敗:', e);
        return null;
    }
}

/**
 * 發送歡迎訊息
 */
async function sendWelcomeMessage(userId, displayName = '') {
    const greeting = displayName ? `${displayName}，` : '';

    await client.pushMessage({
        to: userId,
        messages: [{
            type: 'text',
            text: `🏠 ${greeting}歡迎使用 591 租屋小幫手！

我會每天幫你搜尋符合條件的租屋物件，並透過 LINE 通知你。

📍 預設地區：台北市
💰 預設租金：8,000 - 15,000 元

🎮 快速指令：
• 輸入「指令」查看完整說明
• 輸入「設定」查看個人設定
• 輸入「地區 XX」更改地區
• 輸入「租金 XXXX-XXXX」調整租金
• 輸入「搜尋」立即開始找房！

祝你早日找到理想的房子！🎉`
        }]
    });
}

/**
 * 發送用戶設定訊息
 */
async function sendUserSettings(userId, user, replyToken = null) {
    const message = {
        type: 'flex',
        altText: '個人設定',
        contents: {
            type: 'bubble',
            size: 'kilo',
            header: {
                type: 'box',
                layout: 'vertical',
                contents: [{
                    type: 'text',
                    text: '⚙️ 個人設定',
                    weight: 'bold',
                    size: 'lg',
                    color: '#FFFFFF'
                }],
                backgroundColor: '#3498DB',
                paddingAll: 'lg'
            },
            body: {
                type: 'box',
                layout: 'vertical',
                contents: [
                    {
                        type: 'box',
                        layout: 'horizontal',
                        contents: [
                            { type: 'text', text: '📍 地區', size: 'sm', color: '#888888', flex: 2 },
                            { type: 'text', text: user.region || '台北市', size: 'sm', weight: 'bold', flex: 3 }
                        ]
                    },
                    {
                        type: 'box',
                        layout: 'horizontal',
                        contents: [
                            { type: 'text', text: '💰 租金', size: 'sm', color: '#888888', flex: 2 },
                            { type: 'text', text: `${(user.minRent || 8000).toLocaleString()} - ${(user.maxRent || 15000).toLocaleString()} 元`, size: 'sm', weight: 'bold', flex: 3 }
                        ],
                        margin: 'md'
                    },
                    {
                        type: 'box',
                        layout: 'horizontal',
                        contents: [
                            { type: 'text', text: '🔑 關鍵字', size: 'sm', color: '#888888', flex: 2 },
                            { type: 'text', text: user.keywords || '(未設定)', size: 'sm', flex: 3 }
                        ],
                        margin: 'md'
                    },
                    {
                        type: 'box',
                        layout: 'horizontal',
                        contents: [
                            { type: 'text', text: '🔔 推播', size: 'sm', color: '#888888', flex: 2 },
                            { type: 'text', text: user.subscribed ? '已開啟' : '已暫停', size: 'sm', color: user.subscribed ? '#27AE60' : '#E74C3C', weight: 'bold', flex: 3 }
                        ],
                        margin: 'md'
                    }
                ],
                spacing: 'sm'
            },
            footer: {
                type: 'box',
                layout: 'vertical',
                contents: [{
                    type: 'text',
                    text: '輸入「指令」查看更多操作',
                    size: 'xs',
                    color: '#AAAAAA',
                    align: 'center'
                }]
            }
        }
    };

    if (replyToken) {
        await client.replyMessage({
            replyToken,
            messages: [message]
        });
    } else {
        await client.pushMessage({
            to: userId,
            messages: [message]
        });
    }
}

/**
 * 發送用戶收藏清單
 */
async function sendMyFavorites(userId, favorites, replyToken = null) {
    if (!favorites || favorites.length === 0) {
        const message = {
            type: 'text',
            text: '📭 你還沒有收藏任何物件\n\n瀏覽物件時，點擊「有興趣👍」按鈕即可加入收藏！'
        };

        if (replyToken) {
            await client.replyMessage({ replyToken, messages: [message] });
        } else {
            await client.pushMessage({ to: userId, messages: [message] });
        }
        return;
    }

    // 建立收藏清單 Flex Message
    const bubbles = favorites.slice(0, 10).map((fav, index) => ({
        type: 'bubble',
        size: 'kilo',
        body: {
            type: 'box',
            layout: 'vertical',
            contents: [
                {
                    type: 'text',
                    text: `${index + 1}. ${fav.title || '未知標題'}`,
                    weight: 'bold',
                    size: 'sm',
                    wrap: true,
                    maxLines: 2
                },
                {
                    type: 'box',
                    layout: 'horizontal',
                    contents: [
                        { type: 'text', text: '💰', size: 'sm', flex: 0 },
                        { type: 'text', text: `${fav.price.toLocaleString()} 元/月`, size: 'sm', color: '#E74C3C', weight: 'bold', margin: 'sm' }
                    ],
                    margin: 'md'
                },
                {
                    type: 'box',
                    layout: 'horizontal',
                    contents: [
                        { type: 'text', text: '📍', size: 'sm', flex: 0 },
                        { type: 'text', text: fav.address || '未知地址', size: 'xs', color: '#666666', margin: 'sm', wrap: true }
                    ],
                    margin: 'sm'
                },
                {
                    type: 'box',
                    layout: 'horizontal',
                    contents: [
                        { type: 'text', text: '📞', size: 'sm', flex: 0 },
                        { type: 'text', text: fav.phone || '無電話', size: 'xs', color: '#666666', margin: 'sm' }
                    ],
                    margin: 'sm'
                }
            ],
            spacing: 'sm'
        },
        footer: {
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
            contents: [
                {
                    type: 'button',
                    style: 'primary',
                    height: 'sm',
                    action: {
                        type: 'uri',
                        label: '查看',
                        uri: fav.url
                    },
                    color: '#3498DB'
                }
            ]
        }
    }));

    const gasUrl = `https://script.google.com/macros/s/AKfycbxU7rZrSagLxBBPHBIu_r7ac_AelcX7l9u6-FF2T7xewbIlKwsh7A5_HouoVPBC72ms/exec?userId=${userId}`;

    const summaryMessage = {
        type: 'text',
        text: `⭐ 你的收藏清單 (${favorites.length} 間)\n\n以下是你標記「有興趣」的物件：\n\n📱 查看完整清單網頁版：\n${gasUrl}`
    };

    const carouselMessage = {
        type: 'flex',
        altText: `你的收藏清單 (${favorites.length} 間)`,
        contents: {
            type: 'carousel',
            contents: bubbles
        }
    };

    if (replyToken) {
        await client.replyMessage({
            replyToken,
            messages: [summaryMessage, carouselMessage]
        });
    } else {
        await client.pushMessage({
            to: userId,
            messages: [summaryMessage, carouselMessage]
        });
    }
}

/**
 * 取得用戶資料
 */
async function getUserProfile(userId) {
    try {
        const profile = await client.getProfile(userId);
        return profile;
    } catch (error) {
        console.error(`取得用戶資料失敗 (${userId}):`, error.message);
        return null;
    }
}

module.exports = {
    client,
    sendListingsNotification,
    handlePostback,
    lineMiddleware,
    getUserProfile,
    startLoading,
    sendWelcomeMessage,
    sendUserSettings,
    sendMyFavorites,
    config
};
