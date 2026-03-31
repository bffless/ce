import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ResponseHeaderRuleResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() projectId: string;
  @ApiProperty() pathPattern: string;
  @ApiProperty() framePolicy: 'sameorigin' | 'allow' | 'deny';
  @ApiPropertyOptional() allowedOrigins: string[] | null;
  @ApiPropertyOptional() customHeaders: Record<string, string | null> | null;
  @ApiProperty() priority: number;
  @ApiProperty() isEnabled: boolean;
  @ApiPropertyOptional() name: string | null;
  @ApiPropertyOptional() description: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
