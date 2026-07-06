import { Module } from '@nestjs/common';

import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import { DatabaseModule } from '@/infrastructure/database/database.module';

import { BudgetOperationsController } from './budget-operations.controller';
import { BudgetOperationsService } from './budget-operations.service';

@Module({
  imports: [DatabaseModule],
  controllers: [BudgetOperationsController],
  providers: [BudgetOperationsService, AdminAuthGuard],
})
export class BudgetOperationsModule {}