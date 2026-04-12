/** Normalises any date-like value (Firestore Timestamp, plain Date, epoch object, string) to a JS Date, or null if unparseable. */
export const ensureDate = (val: unknown): Date | null => {
  if (!val) return null;
  if (val instanceof Date) return val;
  if (typeof val === 'object' && val !== null) {
    if (typeof (val as Record<string, unknown>).toDate === 'function') {
      return (val as { toDate: () => Date }).toDate();
    }
    if ('seconds' in val) {
      return new Date((val as { seconds: number }).seconds * 1000);
    }
  }
  const d = new Date(val as string | number);
  return isNaN(d.getTime()) ? null : d;
};
