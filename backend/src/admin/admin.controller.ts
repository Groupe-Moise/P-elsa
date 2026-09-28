import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import type { Request } from 'express';

import { UserRole } from '../generated/prisma/enums';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminService } from './admin.service';
import { CancelTransactionBody } from './dto/cancel-transaction.body';
import { SuspendUserBody } from './dto/suspend-user.body';

interface AuthenticatedRequest extends Request {
  user: {
    id: string;
    phone: string;
    role: UserRole;
  };
}

/**
 * Toutes les routes de ce contrôleur sont réservées au rôle
 * ADMIN (le guard global RolesGuard applique @Roles au niveau du
 * contrôleur à toutes ses routes).
 */
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
  ) {}

  @Get('transactions')
  listOperations(@Query('status') status?: string) {
    return this.adminService.listOperations(status);
  }

  @Post('transactions/:id/retry')
  retryTransaction(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.adminService.retryTransaction(request.user.id, id);
  }

  @Post('transactions/:id/cancel')
  cancelTransaction(
    @Param('id') id: string,
    @Body() body: CancelTransactionBody,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.adminService.cancelTransaction(
      request.user.id,
      id,
      body.reason,
    );
  }

  @Get('overview')
  getOverview() {
    return this.adminService.getOverview();
  }

  @Post('users/:id/suspend')
  suspendUser(
    @Param('id') id: string,
    @Body() body: SuspendUserBody,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.adminService.suspendUser(request.user.id, id, body.reason);
  }

  @Post('users/:id/reactivate')
  reactivateUser(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.adminService.reactivateUser(request.user.id, id);
  }

  @Post('users/:id/unlock-pin')
  unlockPin(
    @Param('id') id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.adminService.unlockUserPin(request.user.id, id);
  }

  @Get('audit-log')
  getAuditLog(@Query('limit') limit?: string) {
    return this.adminService.getAuditLog(
      limit ? Number.parseInt(limit, 10) : undefined,
    );
  }
}
