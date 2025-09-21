import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  ValidationPipe,
} from '@nestjs/common';
import { PointBody as PointDto } from './point.dto';
import { PointHistory, UserPoint } from './point.model';
import { PointService } from './point.service';

@Controller('/point')
export class PointController {
  constructor(private readonly pointService: PointService) {}

  /**
   * 특정 유저의 포인트를 조회하는 기능
   */
  @Get(':id')
  async point(@Param('id', ParseIntPipe) userId: number): Promise<UserPoint> {
    return this.pointService.getUserPoint(userId);
  }

  /**
   * 특정 유저의 포인트 충전/이용 내역을 조회하는 기능
   */
  @Get(':id/histories')
  async history(
    @Param('id', ParseIntPipe) userId: number,
  ): Promise<PointHistory[]> {
    return this.pointService.getPointHistories(userId);
  }

  /**
   * 특정 유저의 포인트를 충전하는 기능
   */
  @Patch(':id/charge')
  async charge(
    @Param('id', ParseIntPipe) userId: number,
    @Body(ValidationPipe) pointDto: PointDto,
  ): Promise<UserPoint> {
    const amount = pointDto.amount;
    return this.pointService.chargePoint(userId, amount);
  }

  /**
   * 특정 유저의 포인트를 사용하는 기능
   */
  @Patch(':id/use')
  async use(
    @Param('id', ParseIntPipe) userId: number,
    @Body(ValidationPipe) pointDto: PointDto,
  ): Promise<UserPoint> {
    const amount = pointDto.amount;
    return this.pointService.usePoint(userId, amount);
  }
}
