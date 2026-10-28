/**
 * Utility to convert Thai Kedmanee keyboard input to English/Numeric barcode.
 * Solves the common retail POS issue where a cashier leaves the keyboard language in TH,
 * causing a barcode scanner (HID keyboard emulation) to type Thai characters instead of numbers/letters.
 */

// Mapping of Thai Kedmanee keys (unshifted & shifted) to English US QWERTY keys
const KEDMANEE_TO_EN_MAP: Record<string, string> = {
  // Row 1 (Numbers row - unshifted)
  'ๅ': '1',
  '/': '2',
  '-': '3',
  'ภ': '4',
  'ถ': '5',
  'ุ': '6',
  'ึ': '7',
  'ค': '8',
  'ต': '9',
  'จ': '0',
  'ข': '-',
  'ช': '=',

  // Row 1 (Numbers row - shifted symbols / Thai numerals)
  '+': '!',
  '๑': '@',
  '๒': '#',
  '๓': '$',
  '๔': '%',
  'ู': '^',
  '฿': '&',
  '๕': '*',
  '๖': '(',
  '๗': ')',
  '๘': '_',
  '๙': '+',

  // Row 2 (Q-P row - unshifted)
  'ๆ': 'q',
  'ไ': 'w',
  'ำ': 'e',
  'พ': 'r',
  'ะ': 't',
  'ั': 'y',
  'ี': 'u',
  'ร': 'i',
  'น': 'o',
  'ย': 'p',
  'บ': '[',
  'ล': ']',
  'ฃ': '\\',

  // Row 2 (Q-P row - shifted)
  '๐': 'Q',
  '"': 'W',
  '“': 'W',
  '”': 'W',
  'ฎ': 'E',
  'ฑ': 'R',
  'ธ': 'T',
  'ํ': 'Y',
  '๊': 'U',
  'ณ': 'I',
  'ฯ': 'O',
  'ญ': 'P',
  'ฐ': '{',
  ',': '}',
  'ฅ': '|',

  // Row 3 (A-L row - unshifted)
  'ฟ': 'a',
  'ห': 's',
  'ก': 'd',
  'ด': 'f',
  'เ': 'g',
  '้': 'h',
  '่': 'j',
  'า': 'k',
  'ส': 'l',
  'ว': ';',
  'ง': "'",

  // Row 3 (A-L row - shifted)
  'ฤ': 'A',
  'ฆ': 'S',
  'ฏ': 'D',
  'โ': 'F',
  'ฌ': 'G',
  '็': 'H',
  '๋': 'J',
  'ษ': 'K',
  'ศ': 'L',
  'ซ': ':',
  '.': '"',

  // Row 4 (Z-M row - unshifted)
  'ผ': 'z',
  'ป': 'x',
  'แ': 'c',
  'อ': 'v',
  'ิ': 'b',
  'ื': 'n',
  'ท': 'm',
  'ม': ',',
  'ใ': '.',
  'ฝ': '/',

  // Row 4 (Z-M row - shifted)
  '(': 'Z',
  ')': 'X',
  'ฉ': 'C',
  'ฮ': 'V',
  'ฺ': 'B',
  '์': 'N',
  '?': 'M',
  'ฒ': '<',
  'ฬ': '>',
  'ฦ': '?',
};

// Shifted number symbols fallback (e.g. ! -> 1, @ -> 2) if caps lock was active on scanner
const SHIFTED_NUM_MAP: Record<string, string> = {
  '!': '1',
  '@': '2',
  '#': '3',
  '$': '4',
  '%': '5',
  '^': '6',
  '&': '7',
  '*': '8',
  '(': '9',
  ')': '0',
};

// Thai digit characters fallback (๐-๙ -> 0-9)
const THAI_DIGITS_MAP: Record<string, string> = {
  '๐': '0',
  '๑': '1',
  '๒': '2',
  '๓': '3',
  '๔': '4',
  '๕': '5',
  '๖': '6',
  '๗': '7',
  '๘': '8',
  '๙': '9',
};

/**
 * Checks if the text contains any Thai characters.
 */
export function hasThaiCharacters(text: string): boolean {
  return /[\u0E00-\u0E7F]/.test(text);
}

/**
 * Converts a raw scanned string containing Thai Kedmanee characters into standard English/Digits.
 * If the string is already English/Digits, it returns the string unchanged.
 */
export function convertThaiToEnBarcode(raw: string): string {
  if (!raw) return '';

  let converted = '';
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (KEDMANEE_TO_EN_MAP[char] !== undefined) {
      converted += KEDMANEE_TO_EN_MAP[char];
    } else {
      converted += char;
    }
  }

  // If the converted result contains shifted number symbols like !@#$ (from CapsLock/Shift on Thai keyboard)
  // and looks like an EAN/numeric barcode, unshift them back to digits
  if (/^[!@#$%^&*()_+\-0-9a-zA-Z]+$/.test(converted) && /[!@#$%^&*()]/.test(converted)) {
    let unshifted = '';
    for (let i = 0; i < converted.length; i++) {
      const c = converted[i];
      unshifted += SHIFTED_NUM_MAP[c] || c;
    }
    // Only use unshifted if it yields a clean numeric/alphanumeric barcode
    if (/^[0-9a-zA-Z\-]+$/.test(unshifted)) {
      return unshifted;
    }
  }

  return converted;
}
