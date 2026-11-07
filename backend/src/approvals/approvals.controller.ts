import { Body, Controller, Get, Param, Post, Put, Query, Req, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, RequirePermissions } from '../auth/roles.decorator';
import { clientIp } from '../auth/login-throttle';
import { ApprovalsService } from './approvals.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  /** Mode 1: approver enters PIN on the requester's terminal. */
  @RequirePermissions('POS_SELL')
  @Post('pin')
  pin(@Body() body: any, @Request() req: any, @Req() raw: any) {
    return this.approvals.approveWithPin(body, req.user, clientIp(raw));
  }

  /** Mode 2: send the request to approvers on other devices (pending until decided). */
  @RequirePermissions('POS_SELL')
  @Post('requests')
  createRequest(@Body() body: any, @Request() req: any) {
    return this.approvals.createRemoteRequest(body, req.user);
  }

  @RequirePermissions('POS_SELL', 'APPROVE_OVERRIDES', 'VIEW_REPORTS')
  @Get(':id')
  get(@Param('id') id: string, @Request() req: any) {
    return this.approvals.get(id, req.user);
  }

  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('APPROVE_OVERRIDES')
  @Post(':id/decide')
  decide(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.approvals.decide(id, body, req.user);
  }

  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('APPROVE_OVERRIDES', 'VIEW_REPORTS')
  @Get()
  list(@Query() q: any) {
    return this.approvals.list(q);
  }

  @RequirePermissions('POS_SELL', 'VIEW_REPORTS')
  @Get('rules/current')
  rules() {
    return this.approvals.getRules();
  }

  @Roles('ADMIN')
  @Put('rules/current')
  setRules(@Body() body: any) {
    return this.approvals.setRules(body);
  }
}
