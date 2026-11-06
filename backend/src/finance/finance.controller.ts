import { Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { RequirePermissions } from '../auth/roles.decorator';
import { FinanceService } from './finance.service';
import { PlanningService } from './planning.service';

/** Store money: accounts, transfers (deposit / withdraw / exchange), expenses, owner money. */
@UseGuards(JwtAuthGuard, RolesGuard)
@RequirePermissions('MANAGE_FINANCE')
@Controller('finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService, private readonly planning: PlanningService) {}

  @Get('accounts') listAccounts() { return this.finance.listAccounts(); }
  @Post('accounts') createAccount(@Body() body: any) { return this.finance.createAccount(body); }
  @Patch('accounts/:id') updateAccount(@Param('id') id: string, @Body() body: any) { return this.finance.updateAccount(id, body); }
  @Post('accounts/:id/opening') setOpening(@Param('id') id: string, @Body() body: any, @Request() req: any) { return this.finance.setOpening(id, body, req.user); }
  @Post('accounts/:id/adjust') adjust(@Param('id') id: string, @Body() body: any, @Request() req: any) { return this.finance.adjustToActual(id, body, req.user); }

  @Post('transfers') transfer(@Body() body: any, @Request() req: any) { return this.finance.createTransfer(body, req.user); }
  @Post('transfers/:groupId/cancel') cancelTransfer(@Param('groupId') id: string, @Body() body: any, @Request() req: any) { return this.finance.cancelTransfer(id, body, req.user); }

  @Post('owner') owner(@Body() body: any, @Request() req: any) { return this.finance.ownerMoney(body, req.user); }

  @RequirePermissions('MANAGE_FINANCE', 'POS_SELL')
  @Get('expense-categories') categories() { return this.finance.listCategories(); }
  @Post('expense-categories') createCategory(@Body() body: any) { return this.finance.createCategory(body); }
  @Patch('expense-categories/:id') updateCategory(@Param('id') id: string, @Body() body: any) { return this.finance.updateCategory(id, body); }

  @Get('expenses') expenses(@Query() q: any) { return this.finance.listExpenses(q); }
  @Get('expenses/:id') expense(@Param('id') id: string) { return this.finance.getExpense(id); }
  @Post('expenses') createExpense(@Body() body: any, @Request() req: any) { return this.finance.createExpense(body, req.user); }
  @Post('expenses/:id/cancel') cancelExpense(@Param('id') id: string, @Body() body: any, @Request() req: any) { return this.finance.cancelExpense(id, body, req.user); }

  @Get('transactions') transactions(@Query() q: any) { return this.finance.listTransactions(q); }
  @Get('summary') summary(@Query() q: any) { return this.finance.summary(q); }
  @Get('overview') overview() { return this.finance.overview(); }

  // ─── phase 3: recurring expenses, forecast, P&L, bank reconciliation ───
  @Get('recurring') recurring() { return this.planning.listRecurring(); }
  @Post('recurring') createRecurring(@Body() body: any) { return this.planning.createRecurring(body); }
  @Patch('recurring/:id') updateRecurring(@Param('id') id: string, @Body() body: any) { return this.planning.updateRecurring(id, body); }
  @Post('recurring/:id/pay') payRecurring(@Param('id') id: string, @Body() body: any, @Request() req: any) { return this.planning.payRecurring(id, body, req.user); }
  @Post('recurring/:id/skip') skipRecurring(@Param('id') id: string, @Body() body: any) { return this.planning.skipRecurring(id, body); }
  @Get('forecast') forecast(@Query('days') days?: string) { return this.planning.forecast(Number(days)); }
  @Get('profit-loss') profitLoss(@Query() q: any) { return this.planning.profitAndLoss(q); }
  @Get('reconcile/:accountId') reconcileState(@Param('accountId') id: string, @Query() q: any) { return this.planning.reconcileState(id, q); }
  @Post('reconcile/:accountId') reconcile(@Param('accountId') id: string, @Body() body: any, @Request() req: any) { return this.planning.reconcile(id, body, req.user); }
}
