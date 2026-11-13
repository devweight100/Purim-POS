import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import { receiptOptionsInputError } from '../../../shared/src/receipt-options';

/** Decimal columns come back from GET as strings ("0.01"); the settings page sends them back as-is. */
const toNumber = ({ value }: { value: unknown }) =>
  value === null || value === undefined || value === '' ? value : typeof value === 'string' ? Number(value) : value;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Fields a MANAGE_SETTINGS user may change through PATCH/PUT /settings. Everything else
 * (id, createdAt, approvalRules, backupOffsiteDir, ...) is stripped by the global whitelist pipe;
 * approval rules and the offsite backup folder have their own ADMIN-only, validated endpoints.
 */
export class UpdateSettingsDto {
  @ValidateIf((o) => o.storeName !== undefined)
  @Transform(trim)
  @IsString({ message: 'ชื่อร้านต้องเป็นข้อความ' })
  @IsNotEmpty({ message: 'กรุณาระบุชื่อร้าน' })
  @MaxLength(200)
  storeName?: string;

  @IsOptional() @IsString() @MaxLength(200) branchName?: string | null;
  @IsOptional() @IsString() @MaxLength(50) storePhone?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) storeAddress?: string | null;
  @IsOptional() @IsString() @MaxLength(200) storeEmail?: string | null;
  @IsOptional() @IsString() @MaxLength(500) logoUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(500) qrImageUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(200) qrLabel?: string | null;
  @IsOptional() @IsString() @MaxLength(50) taxId?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) receiptHeader?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) receiptFooter?: string | null;

  @ValidateIf((o) => o.vatRate !== undefined)
  @Transform(toNumber)
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: 'อัตรา VAT ต้องเป็นตัวเลข' })
  @Min(0, { message: 'อัตรา VAT ต้องอยู่ระหว่าง 0-100' })
  @Max(100, { message: 'อัตรา VAT ต้องอยู่ระหว่าง 0-100' })
  vatRate?: number;

  @ValidateIf((o) => o.vatEnabled !== undefined)
  @IsBoolean({ message: 'การเปิด/ปิด VAT ไม่ถูกต้อง' })
  vatEnabled?: boolean;

  @ValidateIf((o) => o.pointsPerBaht !== undefined)
  @Transform(toNumber)
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: 'อัตราแต้มต้องเป็นตัวเลข' })
  @Min(0) @Max(1000000)
  pointsPerBaht?: number;

  @ValidateIf((o) => o.pointValue !== undefined)
  @Transform(toNumber)
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: 'มูลค่าแต้มต้องเป็นตัวเลข' })
  @Min(0) @Max(1000000)
  pointValue?: number;

  @ValidateIf((o) => o.lowStockThreshold !== undefined)
  @Transform(toNumber)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 }, { message: 'เกณฑ์สต็อกต่ำต้องเป็นตัวเลข (ทศนิยมไม่เกิน 2 ตำแหน่ง)' })
  @Min(0, { message: 'เกณฑ์สต็อกต่ำต้องอยู่ระหว่าง 0-100000' })
  @Max(100000, { message: 'เกณฑ์สต็อกต่ำต้องอยู่ระหว่าง 0-100000' })
  lowStockThreshold?: number;

  /** Quantities may have up to 2 decimals (sell by metre / kg). Off = whole units only, as before. */
  @ValidateIf((o) => o.allowDecimalQty !== undefined)
  @IsBoolean({ message: 'การเปิด/ปิดจำนวนทศนิยมไม่ถูกต้อง' })
  allowDecimalQty?: boolean;

  @ValidateIf((o) => o.cashMovementApprovalLimit !== undefined)
  @Transform(toNumber)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 }, { message: 'วงเงินเงินสดเข้า/ออกต้องเป็นตัวเลข' })
  @Min(0, { message: 'วงเงินเงินสดเข้า/ออกต้องไม่ติดลบ' })
  @Max(9999999999, { message: 'วงเงินเงินสดเข้า/ออกมากเกินไป' })
  cashMovementApprovalLimit?: number;

  /** What slips / A4 documents show ({ slip: { showAddress: false, ... }, a4: {...} }); null = defaults. */
  @ValidateIf((o) => o.receiptOptions !== undefined)
  @ValidateBy({
    name: 'isReceiptOptions',
    validator: {
      validate: (value: unknown) => receiptOptionsInputError(value) === null,
      defaultMessage: (args) => receiptOptionsInputError(args?.value) || 'รูปแบบใบเสร็จไม่ถูกต้อง',
    },
  })
  receiptOptions?: Record<string, Record<string, boolean>> | null;

  @IsOptional()
  @IsObject({ message: 'การตั้งค่าแต้มสะสมไม่ถูกต้อง' })
  loyaltyConfig?: Record<string, unknown> | null;
}

/** Keys of UpdateSettingsDto that are present in the validated body. */
export const SETTINGS_FIELDS = [
  'storeName', 'branchName', 'storePhone', 'storeAddress', 'storeEmail', 'logoUrl', 'qrImageUrl', 'qrLabel',
  'taxId', 'receiptHeader', 'receiptFooter', 'vatRate', 'vatEnabled', 'pointsPerBaht', 'pointValue',
  'lowStockThreshold', 'allowDecimalQty', 'cashMovementApprovalLimit', 'loyaltyConfig',
  'receiptOptions',
] as const;
