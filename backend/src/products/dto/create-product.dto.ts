import { IsString, IsNotEmpty, IsOptional, IsNumber, IsBoolean, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class ProductPackagingUnitDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsNumber()
  @IsOptional()
  qtyPerPrev?: number;

  @IsString()
  @IsOptional()
  barcode?: string;

  @IsNumber()
  @IsOptional()
  priceLevel1?: number;

  @IsNumber()
  @IsOptional()
  priceLevel2?: number;

  @IsNumber()
  @IsOptional()
  priceLevel3?: number;

  @IsNumber()
  @IsOptional()
  priceLevel4?: number;

  @IsNumber()
  @IsOptional()
  priceLevel5?: number;
}

export class ProductImageDto {
  /** id of one of the product's existing photos (kept as is; the list sends URLs, not the data) */
  @IsString()
  @IsOptional()
  id?: string;

  @IsString()
  @IsOptional()
  dataUrl?: string;

  /** small JPEG made by the browser for lists (optional) */
  @IsString()
  @IsOptional()
  thumbDataUrl?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsBoolean()
  @IsOptional()
  isCover?: boolean;
}

export class ProductWholesalePriceDto {
  @IsNumber()
  @IsOptional()
  minQuantity?: number;

  @IsNumber()
  @IsOptional()
  unitPrice?: number;
}

export class ProductBundleItemDto {
  @IsString()
  childProductId!: string;

  @IsNumber()
  quantity!: number;
}

/** A supplier of the product with its purchase cost (product form "ผู้จำหน่ายและต้นทุน"). */
export class ProductSupplierEntryDto {
  @IsString()
  @IsNotEmpty()
  supplierId!: string;

  @IsNumber()
  @IsOptional()
  unitCost?: number;

  @IsNumber()
  @IsOptional()
  lastCost?: number;

  /** รหัสสินค้าของผู้ขาย (max 100 characters, trimmed) */
  @IsString()
  @IsOptional()
  supplierSku?: string;

  /** ชื่อสินค้าของผู้ขาย (max 200 characters, trimmed) */
  @IsString()
  @IsOptional()
  supplierProductName?: string | null;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsBoolean()
  @IsOptional()
  isPreferred?: boolean;
}

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  /** ชื่อผู้ผลิต (optional, max 200 characters, trimmed; blank / null = none) */
  @IsString()
  @IsOptional()
  manufacturerName?: string | null;

  @IsString()
  @IsOptional()
  description?: string;

  /**
   * Product code (owner, Round B): typed by the user on create / edit, blank = the server generates one on create
   * (and keeps the stored one on edit). Unique against every product SKU and barcode.
   */
  @IsString()
  @IsOptional()
  sku?: string;

  @IsString()
  @IsOptional()
  categoryId?: string;

  @IsNumber()
  @IsNotEmpty()
  basePrice!: number;

  @IsNumber()
  @IsOptional()
  costPrice?: number;

  @IsNumber()
  @IsOptional()
  priceLevel1?: number;

  @IsNumber()
  @IsOptional()
  priceLevel2?: number;

  @IsNumber()
  @IsOptional()
  priceLevel3?: number;

  @IsNumber()
  @IsOptional()
  priceLevel4?: number;

  @IsNumber()
  @IsOptional()
  priceLevel5?: number;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsString()
  @IsOptional()
  imageUrl?: string;

  @IsBoolean()
  @IsOptional()
  isBundle?: boolean;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  barcodes?: string[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ProductPackagingUnitDto)
  packagingUnits?: ProductPackagingUnitDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images?: ProductImageDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ProductWholesalePriceDto)
  wholesalePrices?: ProductWholesalePriceDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ProductBundleItemDto)
  bundleItems?: ProductBundleItemDto[];

  /**
   * Supplier rows (BUG-06 v1.5.3: the global whitelist pipe dropped this field, so suppliers chosen in the product
   * form were never saved). Sent = replaces the product's supplier list; omitted = kept.
   */
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ProductSupplierEntryDto)
  supplierEntries?: ProductSupplierEntryDto[];
}
