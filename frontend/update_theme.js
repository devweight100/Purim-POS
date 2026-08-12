const fs = require('fs');
const path = require('path');

function replaceAll(file, replacements) {
    let content = fs.readFileSync(file, 'utf8');
    for (const [regex, replacement] of replacements) {
        content = content.replace(regex, replacement);
    }
    fs.writeFileSync(file, content);
}

// DASHBOARD
const dashboardFile = path.join(__dirname, 'src/app/(main)/dashboard/page.tsx');
replaceAll(dashboardFile, [
    [/bg-slate-900 border-slate-800/g, 'bg-white border border-slate-200 shadow-sm'],
    [/text-slate-100/g, 'text-slate-900'],
    [/text-slate-400/g, 'text-slate-500'],
    [/backgroundColor: '#0f172a', borderColor: '#1e293b'/g, "backgroundColor: '#ffffff', borderColor: '#e2e8f0'"],
    [/color: '#f59e0b'/g, "color: '#0ea5e9'"],
    [/stroke="#f59e0b"/g, 'stroke="#0ea5e9"'],
    [/stopColor="#f59e0b"/g, 'stopColor="#0ea5e9"'],
    [/fill="#10b981"/g, 'fill="#0ea5e9"'],
    [/cursor=\{\{fill: '#1e293b'\}\}/g, "cursor={{fill: '#f1f5f9'}}"],
    [/stroke="#64748b"/g, 'stroke="#94a3b8"']
]);

// INVENTORY
const inventoryFile = path.join(__dirname, 'src/app/(main)/inventory/page.tsx');
replaceAll(inventoryFile, [
    [/text-slate-100/g, 'text-slate-900'],
    [/text-slate-200/g, 'text-slate-900'],
    [/text-slate-300/g, 'text-slate-700'],
    [/text-slate-400/g, 'text-slate-500'],
    [/text-white/g, 'text-slate-900'], // for active items, we will fix below
    [/bg-amber-600 hover:bg-amber-700 text-slate-900/g, 'bg-amber-600 hover:bg-amber-700 text-white'],
    [/bg-slate-900 border-slate-700/g, 'bg-white border-slate-300'],
    [/bg-slate-900 border-slate-800/g, 'bg-white border border-slate-200 shadow-sm'],
    [/bg-slate-900 border border-slate-800/g, 'bg-white border border-slate-200'],
    [/bg-slate-800 text-slate-900/g, 'bg-sky-50 text-sky-700'], // text-white -> text-slate-900 already happened
    [/bg-slate-900/g, 'bg-white'],
    [/bg-slate-950/g, 'bg-slate-50'],
    [/border-slate-800/g, 'border-slate-200'],
    [/border-slate-700/g, 'border-slate-300'],
    [/border-green-900\/50 text-green-400 bg-slate-50\/30/g, 'border-green-200 text-green-700 bg-green-50'],
    [/border-green-900\/50 text-green-400 bg-green-950\/30/g, 'border-green-200 text-green-700 bg-green-50'],
    [/bg-red-950 text-red-400 border-red-900\/50/g, 'bg-red-50 text-red-600 border-red-200'],
    [/hover:bg-slate-800\/50/g, 'hover:bg-slate-50'],
    [/divide-slate-800/g, 'divide-slate-200'],
    [/text-slate-500 hover:text-slate-900/g, 'text-slate-500 hover:text-slate-700'],
    [/hover:bg-amber-700 text-slate-900/g, 'hover:bg-amber-700 text-white'],
    [/text-slate-500 hover:text-slate-900/g, 'text-sky-600 hover:text-sky-700'],
    [/text-slate-400 hover:text-slate-900/g, 'text-slate-500 hover:text-slate-800'],
    [/bg-amber-600 hover:bg-amber-700 text-slate-900/g, 'bg-sky-500 hover:bg-sky-600 text-white']
]);

// Restore button text color on inventory
let inv = fs.readFileSync(inventoryFile, 'utf8');
inv = inv.replace(/bg-amber-600 hover:bg-amber-700 text-slate-900/, 'bg-amber-600 hover:bg-amber-700 text-white');
inv = inv.replace(/activeCategory === 'all' \? 'bg-sky-50 text-sky-700' : 'text-slate-500'/, "activeCategory === 'all' ? 'bg-sky-50 text-sky-700' : 'text-slate-500'");
fs.writeFileSync(inventoryFile, inv);


// SUPPLIERS
const suppliersFile = path.join(__dirname, 'src/app/(main)/suppliers/page.tsx');
replaceAll(suppliersFile, [
    [/bg-slate-900\/50/g, 'bg-slate-50'],
    [/bg-slate-950\/50/g, 'bg-slate-50'],
    [/bg-slate-950/g, 'bg-white'],
    [/bg-slate-900/g, 'bg-white'],
    [/border-slate-800/g, 'border-slate-200'],
    [/border-slate-700/g, 'border-slate-300'],
    [/text-slate-100/g, 'text-slate-900'],
    [/text-slate-200/g, 'text-slate-900'],
    [/text-slate-300/g, 'text-slate-700'],
    [/text-slate-400/g, 'text-slate-500'],
    [/hover:bg-slate-800\/50/g, 'hover:bg-slate-50'],
    [/hover:bg-slate-800/g, 'hover:bg-slate-100'],
    [/text-slate-500 hover:text-amber-500/g, 'text-slate-500 hover:text-amber-600'],
    [/text-slate-500 hover:text-red-500/g, 'text-slate-500 hover:text-red-600'],
    [/bg-amber-500 hover:bg-amber-600 text-slate-900/g, 'bg-sky-500 hover:bg-sky-600 text-white'],
    [/bg-white text-slate-200/g, 'bg-white text-slate-900'] // dialog text color fix
]);


// ORDERS
const ordersFile = path.join(__dirname, 'src/app/(main)/orders/page.tsx');
replaceAll(ordersFile, [
    [/bg-slate-900\/50/g, 'bg-slate-50'],
    [/bg-slate-950\/50/g, 'bg-slate-50'],
    [/bg-slate-950/g, 'bg-white'],
    [/bg-slate-900/g, 'bg-white'],
    [/border-slate-800/g, 'border-slate-200'],
    [/border-slate-700/g, 'border-slate-300'],
    [/text-slate-100/g, 'text-slate-900'],
    [/text-slate-200/g, 'text-slate-900'],
    [/text-slate-300/g, 'text-slate-700'],
    [/text-slate-400/g, 'text-slate-500'],
    [/hover:bg-slate-800\/50/g, 'hover:bg-slate-50'],
    [/hover:bg-slate-800/g, 'hover:bg-slate-100'],
    [/bg-emerald-500\/20 text-emerald-400 border-emerald-500\/30/g, 'bg-emerald-50 text-emerald-700 border-emerald-200'],
    [/bg-red-500\/20 text-red-400 border-red-500\/30/g, 'bg-red-50 text-red-600 border-red-200'],
    [/bg-slate-800/g, 'bg-slate-50'], // Payment section
    [/text-amber-500/g, 'text-sky-600'],
    [/border-red-500\/50 text-red-400 hover:bg-red-500\/10/g, 'border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700'],
    [/text-white/g, 'text-white'], // keeps red button white
    [/bg-red-500 hover:bg-red-600 text-white/g, 'bg-red-500 hover:bg-red-600 text-white']
]);

console.log("Theme update complete!");
