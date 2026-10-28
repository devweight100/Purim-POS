import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { BankAccountsService } from './bank-accounts.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles, RequirePermissions } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('bank-accounts')
export class BankAccountsController {
  constructor(private readonly accountsService: BankAccountsService) {}

  @Get()
  getAll() {
    return this.accountsService.getAll();
  }

  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('MANAGE_SETTINGS')
  @Post()
  create(@Body() body: any) {
    return this.accountsService.create(body);
  }

  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('MANAGE_SETTINGS')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.accountsService.update(id, body);
  }

  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('MANAGE_SETTINGS')
  @Patch(':id/set-default')
  setDefault(@Param('id') id: string) {
    return this.accountsService.setDefault(id);
  }

  @Roles('ADMIN', 'MANAGER')
  @RequirePermissions('MANAGE_SETTINGS')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.accountsService.remove(id);
  }
}
