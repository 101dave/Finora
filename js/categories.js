/** Fixed category lists — user-defined categories are a later, bigger decision. */

export const EXPENSE_CATEGORIES = [
  'Food',
  'Groceries',
  'Transport',
  'Bills',
  'Rent',
  'Health',
  'Shopping',
  'Fun',
  'Education',
  'Other',
];

export const INCOME_CATEGORIES = [
  'Allowance',
  'Salary',
  'Freelance',
  'Gift',
  'Other',
];

export function categoriesFor(type) {
  return type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
}

export function isKnownCategory(type, category) {
  return categoriesFor(type).includes(category);
}

export function allCategories() {
  return [...new Set([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES])];
}

export function typeLabel(type) {
  return type === 'income' ? 'Income' : 'Expense';
}
