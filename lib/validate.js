// Checks for what a counter types or scans on the PDA (Add New Line, counted quantity).
// Each returns "" when fine, otherwise the message to show at the field.

export const MAT_LENGTH = 8;
export const BATCH_LENGTH = 10;

// Mat (SKU): digits only, exactly 8.
export function matError(mat) {
  const m = String(mat ?? "");
  if (!m) return "";
  if (!/^\d+$/.test(m)) return "Mat ต้องเป็นตัวเลขเท่านั้น";
  if (m.length !== MAT_LENGTH) return `Mat ต้องเป็นตัวเลข ${MAT_LENGTH} หลัก (ตอนนี้ ${m.length} หลัก)`;
  return "";
}

// Batch: digits only, exactly 10 (it is saved as scanned or typed, no zeros are added).
export function batchError(batch) {
  const b = String(batch ?? "");
  if (!b) return "";
  if (!/^\d+$/.test(b)) return "Batch ต้องเป็นตัวเลขเท่านั้น";
  if (b.length !== BATCH_LENGTH) return `Batch ต้องเป็นตัวเลข ${BATCH_LENGTH} หลัก (ตอนนี้ ${b.length} หลัก)`;
  return "";
}

// Counted quantity: a number, not negative (any number of decimals).
export function qtyError(qty) {
  const q = String(qty ?? "").trim();
  if (q === "") return "";
  const n = Number(q);
  if (!Number.isFinite(n)) return "จำนวนไม่ถูกต้อง";
  if (n < 0) return "จำนวนต้องไม่ติดลบ";
  return "";
}

// Keys that make no sense in a quantity field (minus sign, plus, exponent).
export function blockQtyKeys(e) {
  if (["-", "+", "e", "E"].includes(e.key)) e.preventDefault();
}
