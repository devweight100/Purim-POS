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
  @IsString()
  @IsOptional()
  dataUrl?: string;

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

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsNotEmpty()
  sku!: string;

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
}
