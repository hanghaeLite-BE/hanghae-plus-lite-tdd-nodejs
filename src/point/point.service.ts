// point.service.ts - 먼저 인터페이스 정의
import { BadRequestException, Injectable } from '@nestjs/common';
import { MemoryLockManager } from 'src/utils/memory-lock.manager';
import { PointHistoryTable } from '../database/pointhistory.table';
import { UserPointTable } from '../database/userpoint.table';
import { PointHistory, TransactionType, UserPoint } from './point.model';

@Injectable()
export class PointService {
  constructor(
    private readonly userPointTable: UserPointTable,
    private readonly pointHistoryTable: PointHistoryTable,
    private readonly memoryLockManager: MemoryLockManager,
  ) {}

  /**
   * 특정 유저의 포인트를 조회하는 기능
   */
  async getUserPoint(userId: number): Promise<UserPoint> {
    const userPoint = await this.userPointTable.selectById(userId);

    return userPoint;
  }

  /**
   * 특정 유저의 포인트를 충전하는 기능
   */
  async chargePoint(userId: number, amount: number): Promise<UserPoint> {
    return this.memoryLockManager.withLock(`user:${userId}`, async () => {
      if (amount <= 0) {
        throw new BadRequestException('충전 금액은 0보다 커야 합니다.');
      }

      const userPoint = await this.userPointTable.selectById(userId);
      const chargedPoint = userPoint.point + amount;
      const updateTime = Date.now();

      await this.userPointTable.insertOrUpdate(userId, chargedPoint);
      await this.pointHistoryTable.insert(
        userId,
        amount,
        TransactionType.CHARGE,
        updateTime,
      );

      return {
        id: userId,
        point: chargedPoint,
        updateMillis: updateTime,
      };
    });
  }

  /**
   * 특정 유저의 포인트를 사용하는 기능
   */
  async usePoint(userId: number, amount: number): Promise<UserPoint> {
    return this.memoryLockManager.withLock(`user:${userId}`, async () => {
      if (amount <= 0) {
        throw new BadRequestException('사용 금액은 0보다 커야 합니다.');
      }

      const userPoint = await this.userPointTable.selectById(userId);

      if (userPoint.point < amount) {
        throw new BadRequestException('포인트가 부족합니다.');
      }

      const usedPoint = userPoint.point - amount;
      const updateTime = Date.now();

      await this.userPointTable.insertOrUpdate(userId, usedPoint);
      await this.pointHistoryTable.insert(
        userId,
        amount,
        TransactionType.USE,
        updateTime,
      );

      return {
        id: userId,
        point: usedPoint,
        updateMillis: updateTime,
      };
    });
  }

  /**
   * 특정 유저의 포인트 충전/이용 내역을 조회하는 기능
   */
  async getPointHistories(userId: number): Promise<PointHistory[]> {
    const histories = await this.pointHistoryTable.selectAllByUserId(userId);

    return histories.sort((a, b) => b.timeMillis - a.timeMillis);
  }
}
