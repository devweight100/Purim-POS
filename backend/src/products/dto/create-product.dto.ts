import { IsString, IsNotEmpty, IsOptional, IsNumber, IsBoolean, IsArray } from 'class-validator';

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
  isActive?: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  barcodes?: string[];
}
