import { nextOccurrence } from './planning.service';

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('nextOccurrence (recurring expenses)', () => {
  it('monthly: next month on the same day', () => {
    expect(ymd(nextOccurrence({ frequency: 'MONTHLY', dayOfMonth: 5 }, new Date(2026, 10, 5)))).toBe('2026-12-05');
  });
  it('monthly: later this month when the day has not come yet', () => {
    expect(ymd(nextOccurrence({ frequency: 'MONTHLY', dayOfMonth: 25 }, new Date(2026, 10, 5)))).toBe('2026-11-25');
  });
  it('monthly day 31 clamps to the last day of shorter months', () => {
    expect(ymd(nextOccurrence({ frequency: 'MONTHLY', dayOfMonth: 31 }, new Date(2027, 0, 31)))).toBe('2027-02-28');
    expect(ymd(nextOccurrence({ frequency: 'MONTHLY', dayOfMonth: 31 }, new Date(2028, 0, 31)))).toBe('2028-02-29');
  });
  it('monthly: December rolls over to January', () => {
    expect(ymd(nextOccurrence({ frequency: 'MONTHLY', dayOfMonth: 10 }, new Date(2026, 11, 10)))).toBe('2027-01-10');
  });
  it('weekly: next given weekday, strictly after', () => {
    const monday = nextOccurrence({ frequency: 'WEEKLY', dayOfWeek: 1 }, new Date(2026, 10, 9)); // 9 Nov 2026 is a Monday
    expect(ymd(monday)).toBe('2026-11-16');
  });
  it('yearly: same date next year once passed', () => {
    expect(ymd(nextOccurrence({ frequency: 'YEARLY', dayOfMonth: 15, monthOfYear: 4 }, new Date(2026, 3, 15)))).toBe('2027-04-15');
    expect(ymd(nextOccurrence({ frequency: 'YEARLY', dayOfMonth: 15, monthOfYear: 4 }, new Date(2026, 0, 1)))).toBe('2026-04-15');
  });
});
