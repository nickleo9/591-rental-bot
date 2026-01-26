
// Verification script for Price Parsing

const rawPrices = [
    "NT$12,000",
    "12000",
    "NT$ 12,000",
    "12,000",
    "$12000"
];

function oldParse(priceStr) {
    return parseInt(priceStr) || 0;
}

function newParse(priceStr) {
    if (typeof priceStr === 'number') return priceStr;
    const cleanStr = String(priceStr).replace(/[^\d]/g, '');
    return parseInt(cleanStr) || 0;
}

console.log("Checking Price Parsing Logic...\n");
console.log(String.padEnd("Raw Input", 15) + String.padEnd("Old Logic", 15) + String.padEnd("New Logic", 15));
console.log("-".repeat(45));

rawPrices.forEach(p => {
    const oldRes = oldParse(p);
    const newRes = newParse(p);
    console.log(
        String(p).padEnd(15) +
        String(oldRes).padEnd(15) +
        String(newRes).padEnd(15)
    );
});
