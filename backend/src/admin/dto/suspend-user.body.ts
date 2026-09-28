import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SuspendUserBody {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
