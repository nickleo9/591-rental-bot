/**
 * LINE Bot 模組
 * 負責發送通知和處理使用者互動
 */

const { Client, messagingApi, middleware } = require('@line/bot-sdk');

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
 * 格式化單一物件訊息
 */
function formatListing(listing, index) {
    const priceFormatted = listing.price.toLocaleString();

    return {
        type: 'bubble',
        size: 'kilo',
        header: {
            type: 'box',
            layout: 'vertical',
            contents: [
                {
                    type: 'text',
                    text: `${index + 1}. ${listing.title}`,
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
                        data: `action=interested&id=${listing.id}&title=${encodeURIComponent(listing.title)}&price=${listing.price}`
                    },
                    color: '#27AE60'
                }
            ]
        }
    };
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
        const bubbles = chunk.map((listing, index) => formatListing(listing, index));

        await client.pushMessage({
            to: userId,
            messages: [{
                type: 'flex',
                altText: `找到 ${chunk.length} 間房屋`,
                contents: {
                    type: 'carousel',
                    contents: bubbles
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
        const title = decodeURIComponent(data.get('title') || '');
        const price = data.get('price');

        // 回覆確認訊息
        await client.replyMessage({
            replyToken: event.replyToken,
            messages: [{
                type: 'text',
                text: `✅ 已將「${title}」加入你的待看清單！\n💰 ${parseInt(price).toLocaleString()} 元/月\n\n物件連結：https://rent.591.com.tw/${id}`
            }]
        });

        return {
            action: 'interested',
            id,
            title,
            price: parseInt(price),
            timestamp: new Date().toISOString()
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

module.exports = {
    client,
    sendListingsNotification,
    handlePostback,
    lineMiddleware,
    getUserProfile,
    config
};
