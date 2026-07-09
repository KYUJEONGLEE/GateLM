import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import { DataEnvelope, ListEnvelope } from '@/common/types/envelope';

import {
  CreateEmployeeDto,
  EmployeeCsvImportResponseDto,
  EmployeeResponseDto,
  ImportEmployeesCsvDto,
  ListEmployeesQueryDto,
  ProjectEmployeeAssignmentResponseDto,
  ProjectEmployeesResponseDto,
  UpdateEmployeeDto,
  UpsertProjectEmployeeAssignmentDto,
} from './dto/employee.dto';
import { EmployeesService } from './employees.service';

@UseGuards(AdminAuthGuard)
@Controller('admin/v1')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get('tenants/:tenantId/employees')
  async listEmployees(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Query() query: ListEmployeesQueryDto,
  ): Promise<ListEnvelope<EmployeeResponseDto>> {
    return this.employeesService.listEmployees(tenantId, query);
  }

  @Post('tenants/:tenantId/employees')
  async createEmployee(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() body: CreateEmployeeDto,
  ): Promise<DataEnvelope<EmployeeResponseDto>> {
    return {
      data: await this.employeesService.createEmployee(tenantId, body),
    };
  }

  @Post('tenants/:tenantId/employees/import-csv')
  async importEmployeesCsv(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() body: ImportEmployeesCsvDto,
  ): Promise<DataEnvelope<EmployeeCsvImportResponseDto>> {
    return {
      data: await this.employeesService.importEmployeesCsv(tenantId, body),
    };
  }

  @Patch('tenants/:tenantId/employees/:employeeId')
  async updateEmployee(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() body: UpdateEmployeeDto,
  ): Promise<DataEnvelope<EmployeeResponseDto>> {
    return {
      data: await this.employeesService.updateEmployee(
        tenantId,
        employeeId,
        body,
      ),
    };
  }

  @Get('projects/:projectId/employees')
  async listProjectEmployees(
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<DataEnvelope<ProjectEmployeesResponseDto>> {
    return {
      data: await this.employeesService.listProjectEmployees(projectId),
    };
  }

  @Post('projects/:projectId/employees/:employeeId')
  async upsertProjectEmployee(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
    @Body() body: UpsertProjectEmployeeAssignmentDto,
  ): Promise<DataEnvelope<ProjectEmployeeAssignmentResponseDto>> {
    return {
      data: await this.employeesService.upsertProjectEmployeeAssignment(
        projectId,
        employeeId,
        body,
      ),
    };
  }

  @Delete('projects/:projectId/employees/:employeeId')
  async disableProjectEmployee(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('employeeId', ParseUUIDPipe) employeeId: string,
  ): Promise<DataEnvelope<ProjectEmployeeAssignmentResponseDto>> {
    return {
      data: await this.employeesService.disableProjectEmployeeAssignment(
        projectId,
        employeeId,
      ),
    };
  }
}
