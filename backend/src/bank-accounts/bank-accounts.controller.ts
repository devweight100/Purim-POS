import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { BankAccountsService } from './bank-accounts.service';
import { JwtAuthGuard } from '../auth/auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('bank-accounts')
export class BankAccountsController {
  constructor(private readonly accountsService: BankAccountsService) {}

  @Get()
  getAll() {
    return this.accountsService.getAll();
  }

  @Post()
  create(@Body() body: any) {
    return this.accountsService.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.accountsService.update(id, body);
  }

  @Patch(':id/set-default')
  setDefault(@Param('id') id: string) {
    return this.accountsService.setDefault(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.accountsService.remove(id);
  }
}
