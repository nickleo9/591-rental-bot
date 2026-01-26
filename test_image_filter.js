
// Test script to verify image URL filtering logic

const testCases = [
    {
        name: "Valid HTTPS Image",
        url: "https://img.591.com/house/2026/01/04/test.jpg",
        expected: "https://img.591.com/house/2026/01/04/test.jpg"
    },
    {
        name: "Valid HTTP Image (Should upgrade to HTTPS)",
        url: "http://img.591.com/house/test.jpg",
        expected: "https://img.591.com/house/test.jpg"
    },
    {
        name: "Data URI (Should be rejected)",
        url: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg==",
        expected: null
    },
    {
        name: "SVG File (Should be rejected)",
        url: "https://img.591.com/static/img/post-loading.svg",
        expected: null
    },
    {
        name: "Too Short URL (Should be rejected)",
        url: "https://a",
        expected: null
    }
];

function processImage(url) {
    if (!url || url.length < 10) return null;

    // Logic from linebot.js
    if (url.startsWith('data:') || url.includes('.svg') || url.includes('post-loading')) return null;

    let processedUrl = url;
    if (processedUrl.startsWith('http://')) {
        processedUrl = processedUrl.replace('http://', 'https://');
    }

    if (processedUrl.startsWith('https://') && processedUrl.length < 2000) {
        return processedUrl;
    }
    return null;
}

console.log("🔍 Starting Image URL Logic Verification...\n");

let passed = true;
testCases.forEach(test => {
    const result = processImage(test.url);
    const isSuccess = result === test.expected;

    console.log(`[${test.name}]`);
    console.log(`Input:    ${test.url.substring(0, 50)}${test.url.length > 50 ? '...' : ''}`);
    console.log(`Output:   ${result}`);
    console.log(`Expected: ${test.expected}`);
    console.log(`Status:   ${isSuccess ? '✅ PASS' : '❌ FAIL'}\n`);

    if (!isSuccess) passed = false;
});

if (passed) {
    console.log("🎉 All image filtering tests passed!");
} else {
    console.error("💥 Some tests failed.");
    process.exit(1);
}
