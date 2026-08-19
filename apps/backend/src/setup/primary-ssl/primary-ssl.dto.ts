import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

class PrimaryRealIpDto {
  @IsString() @IsNotEmpty() header: string;
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) ranges: string[];
}

export class PrimarySslApplyDto {
  @ApiProperty({ enum: ['cloudflare', 'proxy', 'none'] })
  @IsIn(['cloudflare', 'proxy', 'none'])
  proxyMode: 'cloudflare' | 'proxy' | 'none';

  @ApiProperty({ enum: ['paste', 'letsencrypt', 'selfsigned'] })
  @IsIn(['paste', 'letsencrypt', 'selfsigned'])
  sslMode: 'paste' | 'letsencrypt' | 'selfsigned';

  @ApiProperty({ required: false, enum: ['closed', 'redirect'] })
  @IsOptional()
  @IsIn(['closed', 'redirect'])
  port80?: 'closed' | 'redirect';

  @ApiProperty({ required: false, type: PrimaryRealIpDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PrimaryRealIpDto)
  realIp?: PrimaryRealIpDto;
}

export class PrimarySslPasteDto {
  @ApiProperty() @IsString() @IsNotEmpty() certificatePem: string;
  @ApiProperty() @IsString() @IsNotEmpty() privateKeyPem: string;
  @ApiProperty({ enum: ['cloudflare', 'proxy', 'none'] })
  @IsIn(['cloudflare', 'proxy', 'none'])
  servingMode: 'cloudflare' | 'proxy' | 'none';
}

export class PrimarySslDomainActionDto {
  // Day-2 always operates on the fixed primary domain; body is empty but kept
  // for symmetry/future use.
}
