import { describe, it, expect } from 'vitest';
import {
  linearRegression,
  predict,
  buildMonthlyAggregates,
  forecastCategories,
  calculateBudgetHealth,
  detectIncomeType,
  formatAUD,
  formatCompact,
} from '../cashflow';

// ============================================================
// linearRegression
// ============================================================
describe('linearRegression', () => {
  it('returns slope=0, intercept=y[0], r2=0 for single point', () => {
    const result = linearRegression([1], [42]);
    expect(result.slope).toBe(0);
    expect(result.intercept).toBe(42);
    expect(result.r2).toBe(0);
  });

  it('returns slope=0, intercept=mean, r2=0 for empty input', () => {
    const result = linearRegression([], []);
    expect(result.slope).toBe(0);
    expect(result.intercept).toBe(0);
    expect(result.r2).toBe(0);
  });

  it('fits a perfect line y = 2x + 1', () => {
    const x = [1, 2, 3, 4, 5];
    const y = [3, 5, 7, 9, 11];
    const result = linearRegression(x, y);
    expect(result.slope).toBeCloseTo(2, 5);
    expect(result.intercept).toBeCloseTo(1, 5);
    expect(result.r2).toBeCloseTo(1, 5);
  });

  it('returns slope=0, intercept=constant, r2=1 for flat line', () => {
    const x = [1, 2, 3];
    const y = [5, 5, 5];
    const result = linearRegression(x, y);
    expect(result.slope).toBeCloseTo(0, 5);
    expect(result.intercept).toBeCloseTo(5, 5);
    expect(result.r2).toBe(1);
  });

  it('handles decreasing data', () => {
    const x = [1, 2, 3, 4];
    const y = [10, 8, 6, 4];
    const result = linearRegression(x, y);
    expect(result.slope).toBeCloseTo(-2, 5);
    expect(result.r2).toBeCloseTo(1, 5);
  });

  it('r2 is clamped to >= 0', () => {
    // Noisy data — r2 should never be negative
    const x = [1, 2, 3, 4, 5, 6];
    const y = [10, 1, 9, 2, 8, 3];
    const result = linearRegression(x, y);
    expect(result.r2).toBeGreaterThanOrEqual(0);
  });

  it('handles identical x values (denom = 0)', () => {
    const x = [3, 3, 3];
    const y = [1, 2, 3];
    const result = linearRegression(x, y);
    expect(result.slope).toBe(0);
    expect(result.intercept).toBeCloseTo(2, 5); // sumY / n = 6/3
    expect(result.r2).toBe(0);
  });
});

// ============================================================
// predict
// ============================================================
describe('predict', () => {
  it('returns slope * month + intercept', () => {
    const reg = { slope: 2, intercept: 1, r2: 1 };
    expect(predict(reg, 5)).toBe(11);
  });

  it('clamps negative predictions to 0', () => {
    const reg = { slope: -100, intercept: 5, r2: 0.9 };
    expect(predict(reg, 10)).toBe(0);
  });

  it('returns 0 for zero slope and zero intercept', () => {
    const reg = { slope: 0, intercept: 0, r2: 0 };
    expect(predict(reg, 99)).toBe(0);
  });
});

// ============================================================
// buildMonthlyAggregates
// ============================================================
describe('buildMonthlyAggregates', () => {
  it('returns empty array for no expenses', () => {
    expect(buildMonthlyAggregates([])).toEqual([]);
  });

  it('groups expenses by year-month', () => {
    const expenses = [
      { amount: 100, category: 'Food', date: new Date('2024-01-10') },
      { amount: 200, category: 'Food', date: new Date('2024-01-20') },
      { amount: 50, category: 'Transport', date: new Date('2024-02-05') },
    ];
    const result = buildMonthlyAggregates(expenses);
    expect(result).toHaveLength(2);
    expect(result[0].month).toBe(1);
    expect(result[0].total).toBe(300);
    expect(result[0].byCategory['Food']).toBe(300);
    expect(result[1].month).toBe(2);
    expect(result[1].total).toBe(50);
  });

  it('separates income from expenses', () => {
    const expenses = [
      { amount: 500, category: 'Salary', date: new Date('2024-03-01'), type: 'income' as const },
      { amount: 100, category: 'Food', date: new Date('2024-03-15') },
    ];
    const result = buildMonthlyAggregates(expenses);
    expect(result[0].income).toBe(500);
    expect(result[0].total).toBe(100);
    expect(result[0].cashFlow).toBe(400);
  });

  it('calculates savings rate correctly', () => {
    const expenses = [
      { amount: 1000, category: 'Salary', date: new Date('2024-04-01'), type: 'income' as const },
      { amount: 800, category: 'Rent', date: new Date('2024-04-10') },
    ];
    const result = buildMonthlyAggregates(expenses);
    expect(result[0].savingsRate).toBeCloseTo(20, 5); // (200/1000)*100
  });

  it('savingsRate is 0 when no income', () => {
    const expenses = [
      { amount: 100, category: 'Food', date: new Date('2024-05-01') },
    ];
    const result = buildMonthlyAggregates(expenses);
    expect(result[0].savingsRate).toBe(0);
  });

  it('sorts results chronologically', () => {
    const expenses = [
      { amount: 10, category: 'A', date: new Date('2024-06-01') },
      { amount: 20, category: 'B', date: new Date('2023-12-01') },
      { amount: 30, category: 'C', date: new Date('2024-03-01') },
    ];
    const result = buildMonthlyAggregates(expenses);
    expect(result[0].year).toBe(2023);
    expect(result[1].month).toBe(3);
    expect(result[2].month).toBe(6);
  });

  it('income entries are NOT added to byCategory', () => {
    const expenses = [
      { amount: 5000, category: 'Salary', date: new Date('2024-07-01'), type: 'income' as const },
    ];
    const result = buildMonthlyAggregates(expenses);
    expect(result[0].byCategory['Salary']).toBeUndefined();
  });
});

// ============================================================
// forecastCategories
// ============================================================
describe('forecastCategories', () => {
  it('returns empty array when fewer than 2 months', () => {
    const aggregates = [
      { year: 2024, month: 1, total: 100, byCategory: { Food: 100 }, income: 0, cashFlow: -100, savingsRate: 0 },
    ];
    expect(forecastCategories(aggregates)).toEqual([]);
  });

  it('returns a forecast for each category', () => {
    const aggregates = Array.from({ length: 4 }, (_, i) => ({
      year: 2024,
      month: i + 1,
      total: 200,
      byCategory: { Food: 100, Rent: 100 },
      income: 0,
      cashFlow: -200,
      savingsRate: 0,
    }));
    const result = forecastCategories(aggregates);
    const categories = result.map(r => r.category);
    expect(categories).toContain('Food');
    expect(categories).toContain('Rent');
  });

  it('produces 3 forecast values by default', () => {
    const aggregates = Array.from({ length: 3 }, (_, i) => ({
      year: 2024,
      month: i + 1,
      total: 100,
      byCategory: { Food: 50 + i * 10 },
      income: 0,
      cashFlow: 0,
      savingsRate: 0,
    }));
    const result = forecastCategories(aggregates);
    expect(result[0].forecasts).toHaveLength(3);
  });

  it('trend is increasing when spending rises consistently', () => {
    const aggregates = Array.from({ length: 6 }, (_, i) => ({
      year: 2024,
      month: i + 1,
      total: 100 + i * 50,
      byCategory: { Food: 100 + i * 50 },
      income: 0,
      cashFlow: 0,
      savingsRate: 0,
    }));
    const result = forecastCategories(aggregates);
    const food = result.find(r => r.category === 'Food');
    expect(food?.trend).toBe('increasing');
  });

  it('trend is decreasing when spending falls consistently', () => {
    const aggregates = Array.from({ length: 6 }, (_, i) => ({
      year: 2024,
      month: i + 1,
      total: 600 - i * 80,
      byCategory: { Food: 600 - i * 80 },
      income: 0,
      cashFlow: 0,
      savingsRate: 0,
    }));
    const result = forecastCategories(aggregates);
    const food = result.find(r => r.category === 'Food');
    expect(food?.trend).toBe('decreasing');
  });

  it('trend is stable when spending is flat', () => {
    const aggregates = Array.from({ length: 6 }, (_, i) => ({
      year: 2024,
      month: i + 1,
      total: 200,
      byCategory: { Rent: 200 },
      income: 0,
      cashFlow: 0,
      savingsRate: 0,
    }));
    const result = forecastCategories(aggregates);
    const rent = result.find(r => r.category === 'Rent');
    expect(rent?.trend).toBe('stable');
  });

  it('only uses last 6 months of data', () => {
    const aggregates = Array.from({ length: 10 }, (_, i) => ({
      year: 2024,
      month: i + 1,
      total: 100,
      byCategory: { Food: 100 },
      income: 0,
      cashFlow: 0,
      savingsRate: 0,
    }));
    const result = forecastCategories(aggregates);
    expect(result[0].monthlyValues).toHaveLength(6);
  });
});

// ============================================================
// calculateBudgetHealth
// ============================================================
describe('calculateBudgetHealth', () => {
  it('returns excellent (100) for perfect finances', () => {
    const result = calculateBudgetHealth(2000, 800, 5000, 0);
    // spendingRate = 0.4 (<0.75), savingsRate = 0.84 (>0.2), no overBudget, no negative cashflow
    expect(result.grade).toBe('excellent');
    expect(result.score).toBe(100);
    expect(result.color).toBe('#4CAF50');
  });

  it('deducts 30 when spending > 90% of budget', () => {
    // Budget 1000, spent 950 = 95%, savings rate high, no over-budget categories
    const result = calculateBudgetHealth(1000, 950, 5000, 0);
    expect(result.score).toBe(70); // 100 - 30
    expect(result.grade).toBe('needs_attention'); // good requires >= 71
  });

  it('deducts 15 when spending 75-90% of budget', () => {
    const result = calculateBudgetHealth(1000, 800, 5000, 0);
    expect(result.score).toBe(85); // 100 - 15
  });

  it('deducts 20 when savings rate < 10%', () => {
    // income=1000, spent=950 => savingsRate=5%, spendingRate=950/2000=0.475
    const result = calculateBudgetHealth(2000, 950, 1000, 0);
    expect(result.score).toBe(80); // 100 - 20
  });

  it('deducts 10 when savings rate 10-20%', () => {
    // income=1000, spent=850 => savingsRate=15%
    const result = calculateBudgetHealth(2000, 850, 1000, 0);
    expect(result.score).toBe(90); // 100 - 10
  });

  it('deducts 15 for > 2 categories over budget', () => {
    const result = calculateBudgetHealth(2000, 800, 5000, 3);
    expect(result.score).toBe(85); // 100 - 15
  });

  it('deducts 7 for 1-2 categories over budget', () => {
    const result = calculateBudgetHealth(2000, 800, 5000, 1);
    expect(result.score).toBe(93); // 100 - 7
    expect(result.grade).toBe('excellent');
  });

  it('deducts 25 for negative cash flow', () => {
    // income=500, spent=600 => cashflow negative
    const result = calculateBudgetHealth(2000, 600, 500, 0);
    // spendingRate=0.3 ok, savingsRate negative => < 0.1 => -20, cashFlowNeg => -25
    expect(result.score).toBe(55); // 100 - 20 - 25
  });

  it('score is clamped to 0 minimum', () => {
    const result = calculateBudgetHealth(100, 1000, 200, 5);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it('grade is critical when score < 41', () => {
    // Max deductions: 30+20+15+25 = 90, score=10
    const result = calculateBudgetHealth(1000, 980, 800, 5);
    expect(result.grade).toBe('critical');
    expect(result.color).toBe('#C47B6A');
  });

  it('grade is needs_attention for score 41-70', () => {
    // spendingRate high (-30), low savings (-20), score=50
    const result = calculateBudgetHealth(1000, 950, 1000, 0);
    // spendingRate=0.95 => -30, savingsRate=0.05 => -20, score=50
    expect(result.grade).toBe('needs_attention');
    expect(result.color).toBe('#FF9800');
  });

  it('handles zero budget gracefully', () => {
    const result = calculateBudgetHealth(0, 500, 1000, 0);
    // spendingRate = 1 => > 0.9 => -30
    expect(result.score).toBeLessThan(100);
  });

  it('handles zero income gracefully', () => {
    const result = calculateBudgetHealth(2000, 500, 0, 0);
    // savingsRate defaults to 0 => < 0.1 => -20
    expect(result.score).toBe(80);
  });
});

// ============================================================
// detectIncomeType
// ============================================================
describe('detectIncomeType', () => {
  it('detects salary', () => {
    expect(detectIncomeType('Monthly Salary Payment')).toBe('salary');
    expect(detectIncomeType('PAYROLL CREDIT')).toBe('salary');
    expect(detectIncomeType('wages from employer')).toBe('salary');
    expect(detectIncomeType('PAY RUN 2024-01')).toBe('salary');
    expect(detectIncomeType('payslip')).toBe('salary');
  });

  it('detects refund', () => {
    expect(detectIncomeType('Tax Refund ATO')).toBe('refund');
    expect(detectIncomeType('RETURN CREDIT')).toBe('refund');
    expect(detectIncomeType('cashback reward')).toBe('refund');
    expect(detectIncomeType('credit back from merchant')).toBe('refund');
  });

  it('detects transfer', () => {
    expect(detectIncomeType('TFR FROM SAVINGS')).toBe('transfer');
    expect(detectIncomeType('BPAY payment received')).toBe('transfer');
    expect(detectIncomeType('internal transfer')).toBe('transfer');
  });

  it('detects interest', () => {
    expect(detectIncomeType('Interest Credit Jan')).toBe('interest');
    expect(detectIncomeType('INT CREDIT 0.5%')).toBe('interest');
  });

  it('returns other_income for unknown descriptions', () => {
    expect(detectIncomeType('Freelance work')).toBe('other_income');
    expect(detectIncomeType('Gift from parent')).toBe('other_income');
    expect(detectIncomeType('')).toBe('other_income');
  });
});

// ============================================================
// formatAUD
// ============================================================
describe('formatAUD', () => {
  it('formats positive amounts with $ and two decimal places', () => {
    const result = formatAUD(1234.56);
    expect(result).toContain('1,234.56');
    expect(result).toContain('$');
  });

  it('formats zero as $0.00', () => {
    const result = formatAUD(0);
    expect(result).toBe('$0.00');
  });

  it('formats negative amounts', () => {
    const result = formatAUD(-50);
    expect(result).toContain('50.00');
  });

  it('formats whole numbers with .00', () => {
    const result = formatAUD(100);
    expect(result).toBe('$100.00');
  });
});

// ============================================================
// formatCompact
// ============================================================
describe('formatCompact', () => {
  it('returns $Xk for amounts >= 1000', () => {
    expect(formatCompact(1000)).toBe('$1.0k');
    expect(formatCompact(2500)).toBe('$2.5k');
    expect(formatCompact(10000)).toBe('$10.0k');
  });

  it('returns full AUD format for amounts < 1000', () => {
    expect(formatCompact(999)).toBe('$999.00');
    expect(formatCompact(50)).toBe('$50.00');
  });

  it('handles negative large amounts', () => {
    expect(formatCompact(-1500)).toBe('$-1.5k');
  });

  it('handles zero', () => {
    expect(formatCompact(0)).toBe('$0.00');
  });
});
