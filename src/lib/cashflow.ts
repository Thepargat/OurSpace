/**
 * OurSpace — Cash Flow Engine + ML Forecasting
 * Pure JS linear regression. No external libraries.
 */

// ============================================================
// LINEAR REGRESSION
// ============================================================
export interface RegressionResult {
  slope: number;
  intercept: number;
  r2: number; // coefficient of determination (0-1)
}

export const linearRegression = (x: number[], y: number[]): RegressionResult => {
  const n = x.length;
  if (n < 2) return { slope: 0, intercept: y[0] || 0, r2: 0 };

  const sumX  = x.reduce((a, b) => a + b, 0);
  const sumY  = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
  const sumYY = y.reduce((sum, yi) => sum + yi * yi, 0);

  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n, r2: 0 };

  const slope     = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // R² calculation
  const meanY = sumY / n;
  const ssTot = y.reduce((sum, yi) => sum + Math.pow(yi - meanY, 2), 0);
  const ssRes = y.reduce((sum, yi, i) => sum + Math.pow(yi - (slope * x[i] + intercept), 2), 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

  return { slope, intercept, r2: Math.max(0, r2) };
};

export const predict = (reg: RegressionResult, month: number): number => {
  return Math.max(0, reg.slope * month + reg.intercept);
};

// ============================================================
// EXPENSE TYPES
// ============================================================
export interface MonthlySpend {
  year: number;
  month: number; // 1-12
  total: number;
  byCategory: Record<string, number>;
  income: number;
  cashFlow: number;
  savingsRate: number;
}

export interface CategoryForecast {
  category: string;
  monthlyValues: number[];    // historical 6 months
  forecasts: number[];        // next 3 months predicted
  trend: 'increasing' | 'stable' | 'decreasing';
  regression: RegressionResult;
}

// ============================================================
// BUILD MONTHLY AGGREGATES from raw expenses
// ============================================================
export const buildMonthlyAggregates = (
  expenses: Array<{
    amount: number;
    category: string;
    date: Date;
    type?: 'expense' | 'income';
  }>
): MonthlySpend[] => {
  const map = new Map<string, MonthlySpend>();

  for (const exp of expenses) {
    const year  = exp.date.getFullYear();
    const month = exp.date.getMonth() + 1;
    const key   = `${year}-${month}`;

    if (!map.has(key)) {
      map.set(key, { year, month, total: 0, byCategory: {}, income: 0, cashFlow: 0, savingsRate: 0 });
    }

    const entry = map.get(key)!;

    if (exp.type === 'income') {
      entry.income += exp.amount;
    } else {
      entry.total += exp.amount;
      entry.byCategory[exp.category] = (entry.byCategory[exp.category] || 0) + exp.amount;
    }
  }

  // Calculate cash flow + savings rate
  for (const entry of map.values()) {
    entry.cashFlow    = entry.income - entry.total;
    entry.savingsRate = entry.income > 0 ? ((entry.income - entry.total) / entry.income) * 100 : 0;
  }

  return Array.from(map.values()).sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month
  );
};

// ============================================================
// FORECAST PER CATEGORY
// ============================================================
export const forecastCategories = (
  monthlyAggregates: MonthlySpend[],
  forecastMonths = 3
): CategoryForecast[] => {
  // Get last 6 months
  const recent = monthlyAggregates.slice(-6);
  if (recent.length < 2) return [];

  // Collect all categories
  const allCategories = new Set<string>();
  recent.forEach(m => Object.keys(m.byCategory).forEach(c => allCategories.add(c)));

  return Array.from(allCategories).map(category => {
    const monthlyValues = recent.map(m => m.byCategory[category] || 0);
    const x = monthlyValues.map((_, i) => i + 1);
    const reg = linearRegression(x, monthlyValues);

    // Forecast next N months
    const nextBase = monthlyValues.length + 1;
    const forecasts = Array.from({ length: forecastMonths }, (_, i) =>
      predict(reg, nextBase + i)
    );

    // Trend: slope relative to mean monthly spend
    const mean = monthlyValues.reduce((a, b) => a + b, 0) / monthlyValues.length;
    const slopeRatio = mean > 0 ? reg.slope / mean : 0;
    const trend: CategoryForecast['trend'] =
      slopeRatio > 0.05 ? 'increasing' : slopeRatio < -0.05 ? 'decreasing' : 'stable';

    return { category, monthlyValues, forecasts, trend, regression: reg };
  });
};

// ============================================================
// BUDGET HEALTH SCORE (0-100)
// ============================================================
export interface BudgetHealth {
  score: number;
  grade: 'excellent' | 'good' | 'needs_attention' | 'critical';
  label: string;
  color: string;
}

export const calculateBudgetHealth = (
  monthlyBudget: number,
  spent: number,
  income: number,
  categoriesOverBudget: number
): BudgetHealth => {
  let score = 100;

  const spendingRate = monthlyBudget > 0 ? spent / monthlyBudget : 1;
  const savingsRate  = income > 0 ? (income - spent) / income : 0;
  const cashFlowNeg  = income > 0 && spent > income;

  if (spendingRate > 0.9)          score -= 30;
  else if (spendingRate > 0.75)    score -= 15;
  if (savingsRate < 0.1)           score -= 20;
  else if (savingsRate < 0.2)      score -= 10;
  if (categoriesOverBudget > 2)    score -= 15;
  else if (categoriesOverBudget > 0) score -= 7;
  if (cashFlowNeg)                 score -= 25;

  score = Math.max(0, Math.min(100, score));

  if (score >= 91) return { score, grade: 'excellent', label: 'Excellent',       color: '#4CAF50' };
  if (score >= 71) return { score, grade: 'good',      label: 'Good',            color: '#B8955A' };
  if (score >= 41) return { score, grade: 'needs_attention', label: 'Needs Attention', color: '#FF9800' };
  return              { score, grade: 'critical', label: 'Critical',        color: '#C47B6A' };
};

// ============================================================
// INCOME TYPE DETECTION from bank description
// ============================================================
export const detectIncomeType = (description: string): 'salary' | 'refund' | 'transfer' | 'interest' | 'other_income' => {
  const lower = description.toLowerCase();
  if (/salary|payroll|wages|pay run|employer|payslip/.test(lower)) return 'salary';
  if (/refund|return|credit back|cashback/.test(lower))             return 'refund';
  if (/transfer|tfr|bpay|internal/.test(lower))                     return 'transfer';
  if (/interest|int credit/.test(lower))                            return 'interest';
  return 'other_income';
};

// ============================================================
// SPEND VELOCITY — daily rate → month-end projection
// ============================================================
export interface SpendVelocity {
  dailyRate: number;          // average spend per day so far this month
  projectedMonthEnd: number;  // extrapolated to end of month
  overspendAmount: number;    // positive = will bust budget, negative = safe
  daysLeft: number;
  isOnTrack: boolean;
}

export const calculateSpendVelocity = (
  spent: number,
  budget: number,
  dayOfMonth: number,
  daysInMonth: number
): SpendVelocity => {
  const safeDay = Math.max(dayOfMonth, 1);
  const dailyRate = spent / safeDay;
  const daysLeft = daysInMonth - dayOfMonth;
  const projectedMonthEnd = spent + dailyRate * daysLeft;
  const overspendAmount = projectedMonthEnd - budget;
  return {
    dailyRate,
    projectedMonthEnd,
    overspendAmount,
    daysLeft,
    isOnTrack: overspendAmount <= 0,
  };
};

// ============================================================
// RECURRING TRANSACTION DETECTION — 28-35 day intervals
// ============================================================
export interface RecurringCandidate {
  merchantName: string;
  averageAmount: number;
  occurrences: number;
  averageIntervalDays: number;
  nextExpectedDate: Date;
  confidence: 'high' | 'medium';
}

export const detectRecurringTransactions = (
  expenses: Array<{ merchantName: string; total: number; date: Date }>
): RecurringCandidate[] => {
  // Group by normalised merchant name
  const byMerchant: Record<string, Array<{ amount: number; date: Date }>> = {};
  for (const exp of expenses) {
    const key = exp.merchantName.trim().toLowerCase();
    if (!byMerchant[key]) byMerchant[key] = [];
    byMerchant[key].push({ amount: exp.total, date: exp.date });
  }

  const results: RecurringCandidate[] = [];

  for (const [key, entries] of Object.entries(byMerchant)) {
    if (entries.length < 2) continue;

    // Sort chronologically
    const sorted = [...entries].sort((a, b) => a.date.getTime() - b.date.getTime());

    // Calculate intervals between consecutive entries
    const intervals: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const days = (sorted[i].date.getTime() - sorted[i - 1].date.getTime()) / (1000 * 60 * 60 * 24);
      intervals.push(days);
    }

    // Check if all intervals are in the 25-40 day window (monthly ±5 days)
    const inRange = intervals.filter(d => d >= 25 && d <= 40);
    if (inRange.length === 0) continue;
    if (inRange.length / intervals.length < 0.5) continue;

    const avgInterval = inRange.reduce((a, b) => a + b, 0) / inRange.length;
    const avgAmount = sorted.reduce((s, e) => s + e.amount, 0) / sorted.length;

    // Amount consistency check: std dev < 20% of mean
    const variance = sorted.reduce((s, e) => s + Math.pow(e.amount - avgAmount, 2), 0) / sorted.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev / avgAmount > 0.3) continue;

    const lastDate = sorted[sorted.length - 1].date;
    const nextExpectedDate = new Date(lastDate.getTime() + avgInterval * 24 * 60 * 60 * 1000);

    const originalName = expenses.find(e => e.merchantName.trim().toLowerCase() === key)?.merchantName || key;

    results.push({
      merchantName: originalName,
      averageAmount: avgAmount,
      occurrences: sorted.length,
      averageIntervalDays: avgInterval,
      nextExpectedDate,
      confidence: inRange.length >= 2 && stdDev / avgAmount < 0.1 ? 'high' : 'medium',
    });
  }

  return results.sort((a, b) => b.occurrences - a.occurrences);
};

// ============================================================
// SAVINGS MOMENTUM — are you on track to hit your goal?
// ============================================================
export interface SavingsMomentum {
  requiredMonthly: number;    // how much you need to save per month
  currentMonthly: number;     // average you've been saving
  monthsAhead: number;        // positive = ahead, negative = behind
  projectedCompletionDate: Date | null;
  onTrack: boolean;
  message: string;            // human-readable status
}

export const calculateSavingsMomentum = (
  targetAmount: number,
  currentAmount: number,
  targetDate: Date,
  currentMonthlyContribution: number
): SavingsMomentum => {
  const now = new Date();
  const msLeft = targetDate.getTime() - now.getTime();
  const monthsLeft = Math.max(msLeft / (1000 * 60 * 60 * 24 * 30.44), 0.01);
  const remaining = Math.max(targetAmount - currentAmount, 0);
  const requiredMonthly = remaining / monthsLeft;

  // How many months until goal at current rate
  const monthsToGoal = currentMonthlyContribution > 0 ? remaining / currentMonthlyContribution : Infinity;
  const projectedDate = isFinite(monthsToGoal)
    ? new Date(now.getTime() + monthsToGoal * 30.44 * 24 * 60 * 60 * 1000)
    : null;

  const monthsAhead = monthsLeft - monthsToGoal;
  const onTrack = currentMonthlyContribution >= requiredMonthly;

  let message: string;
  if (remaining <= 0) {
    message = 'Goal reached!';
  } else if (onTrack) {
    const aheadMonths = Math.round(Math.abs(monthsAhead));
    message = aheadMonths > 0 ? `${aheadMonths} month${aheadMonths > 1 ? 's' : ''} ahead of schedule` : 'Right on track';
  } else {
    const gap = requiredMonthly - currentMonthlyContribution;
    message = `Behind by ${formatAUD(gap)}/month`;
  }

  return { requiredMonthly, currentMonthly: currentMonthlyContribution, monthsAhead, projectedCompletionDate: projectedDate, onTrack, message };
};

// ============================================================
// FORMAT CURRENCY (AUD)
// ============================================================
export const formatAUD = (amount: number): string => {
  return amount.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
};

export const formatCompact = (amount: number): string => {
  if (Math.abs(amount) >= 1000) {
    return `$${(amount / 1000).toFixed(1)}k`;
  }
  return formatAUD(amount);
};
