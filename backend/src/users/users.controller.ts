import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';

import { UserRole } from '../generated/prisma/enums';
import { UsersService } from './users.service';

interface CreateUserBody {
  phone: string;
  email?: string;
  firstName: string;
  lastName: string;
  role?: UserRole;
}

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  create(@Body() body: CreateUserBody) {
    return this.usersService.create(body);
  }

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get('phone/:phone')
  findByPhone(@Param('phone') phone: string) {
    return this.usersService.findByPhone(phone);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }
}