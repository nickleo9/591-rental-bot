require('dotenv').config();
const sheets = require('./sheets');

// Mock data
const mockListings = [{
    id: `test_${Date.now()}`,
    title: 'Image Test Listing',
    price: 15000,
    address: 'Test Address',
    region: 'Test Region',
    subway: 'Test Subway',
    tags: ['Test Tag'],
    url: 'http://test.com',
    image: 'http://test.com/image.jpg', // Single image property
    images: ['http://test.com/image.jpg'] // Array property
}];

async function verify() {
    console.log('>>> Saving mock listing...');
    await sheets.saveListings(mockListings);

    console.log('>>> Retrieving recent listings...');
    const recent = await sheets.getRecentListings(1);
    const savedMsg = recent.find(l => l.id === mockListings[0].id);

    if (savedMsg && savedMsg.image === 'http://test.com/image.jpg') {
        console.log('✅ Verification SUCCESS: Image URL saved and retrieved correctly.');
    } else {
        console.error('❌ Verification FAILED: Image URL mismatch or not found.');
        console.log('Retrieved:', savedMsg);
    }
}

verify();
