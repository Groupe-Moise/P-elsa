import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
} from '@nestjs/common';

import type { Request } from 'express';

import { UserRole } from '../generated/prisma/enums';
import { Roles } from '../auth/decorators/roles.decorator';
import { UsersService } from './users.service';
import type { CreateUserDto } from './users.service';

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    phone: string;
    role: UserRole;
  };
}

@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
  ) {}

  // Les inscriptions publiques passent par POST /auth/register.
  @Post()
  @Roles(UserRole.ADMIN)
  create(@Body() body: CreateUserDto) {
    return this.usersService.create(body);
  }

  @Get()
  @Roles(UserRole.ADMIN)
  findAll() {
    return this.usersService.findAll();
  }

  @Get('me/profile')
  findMe(@Req() request: AuthenticatedRequest) {
    return this.usersService.findMe(request.user.id);
  }

  // Auto-service : un marchand (VENDOR) génère lui-même son propre code,
  // affiché ensuite sous forme de QR dans l'app (pas d'attribution admin).
  @Post('me/merchant-code')
  generateMerchantCode(@Req() request: AuthenticatedRequest) {
    return this.usersService.generateMerchantCode(request.user.id);
  }

  @Get('phone/:phone')
  @Roles(UserRole.ADMIN)
  findByPhone(@Param('phone') phone: string) {
    return this.usersService.findByPhone(phone);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }
}