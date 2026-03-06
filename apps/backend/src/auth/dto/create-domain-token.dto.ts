import { IsString, IsNotEmpty, IsOptional, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for creating a domain relay token.
 * Used to transfer authentication from the workspace domain to a custom domain.
 */
export class CreateDomainTokenDto {
  @ApiProperty({
    description: 'The target custom domain to authenticate for',
    example: 'docs.acme.com',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/, {
    message: 'targetDomain must be a valid domain name',
  })
  targetDomain: string;

  @ApiPropertyOptional({
    description: 'The path to redirect to after authentication completes',
    example: '/private/docs',
  })
  @IsString()
  @IsOptional()
  redirectPath?: string;
}
