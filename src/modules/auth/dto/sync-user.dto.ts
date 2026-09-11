import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SyncUserDto {
  @ApiProperty({ example: 'student@exambondhubd.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Rahim Uddin' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.jpg' })
  @IsString()
  @IsOptional()
  avatarUrl?: string;

  @ApiPropertyOptional({ example: 'supabase-uuid-here' })
  @IsString()
  @IsOptional()
  supabaseId?: string;
}

export class AdminLoginDto {
  @ApiProperty({ example: 'admin@exambondhubd.com' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ example: 'password123' })
  @IsString()
  @IsOptional()
  password?: string;
}
