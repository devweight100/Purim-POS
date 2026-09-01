const fs = require('fs');
const path = require('path');

// 1. Clean customer-service.ts
const customerServicePath = path.join(__dirname, 'src', 'lib', 'customer-service.ts');
let custContent = fs.readFileSync(customerServicePath, 'utf8');
custContent = custContent.replace(/const INITIAL_CUSTOMERS: Customer\[\] = \[\s*\{[\s\S]*?\}\s*\];/m, 'const INITIAL_CUSTOMERS: Customer[] = [];');
custContent = custContent.replace('saveCustomers(INITIAL_CUSTOMERS);', '// saveCustomers(INITIAL_CUSTOMERS);');
fs.writeFileSync(customerServicePath, custContent, 'utf8');
console.log('✅ Cleaned customer-service.ts');

// 2. Clean debt-service.ts
const debtServicePath = path.join(__dirname, 'src', 'lib', 'debt-service.ts');
let debtContent = fs.readFileSync(debtServicePath, 'utf8');
debtContent = debtContent.replace(/const INITIAL_SAMPLE_DEBTS: DebtRecord\[\] = \[\s*\{[\s\S]*?\}\s*\];/m, 'const INITIAL_SAMPLE_DEBTS: DebtRecord[] = [];');
fs.writeFileSync(debtServicePath, debtContent, 'utf8');
console.log('✅ Cleaned debt-service.ts');

// 3. Clean bank-account-storage.ts
const bankPath = path.join(__dirname, 'src', 'lib', 'bank-account-storage.ts');
let bankContent = fs.readFileSync(bankPath, 'utf8');
bankContent = bankContent.replace(/export const defaultBankAccounts: BankAccount\[\] = \[\s*\{[\s\S]*?\}\s*\];/m, 'export const defaultBankAccounts: BankAccount[] = [];');
fs.writeFileSync(bankPath, bankContent, 'utf8');
console.log('✅ Cleaned bank-account-storage.ts');

// 4. Clean shift-store.ts
const shiftStorePath = path.join(__dirname, 'src', 'lib', 'store', 'shift-store.ts');
let shiftContent = fs.readFileSync(shiftStorePath, 'utf8');
shiftContent = shiftContent.replace(/const loadInitialOrders = \(\): Order\[\] => \{[\s\S]*?return all;\s*\}\s*catch\s*\{[\s\S]*?\}\s*\};/m, 'const loadInitialOrders = (): Order[] => [];');
fs.writeFileSync(shiftStorePath, shiftContent, 'utf8');
console.log('✅ Cleaned shift-store.ts');

console.log('🎉 All mock data arrays in frontend services cleaned!');
