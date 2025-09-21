import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PointHistoryTable } from 'src/database/pointhistory.table';
import { UserPointTable } from 'src/database/userpoint.table';
import { TransactionType } from 'src/point/point.model';
import { PointService } from 'src/point/point.service';
import { MemoryLockManager } from 'src/utils/memory-lock.manager';

describe('PointService 통합 테스트', () => {
  let service: PointService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PointService,
        UserPointTable,
        PointHistoryTable,
        MemoryLockManager,
      ],
    }).compile();

    service = module.get<PointService>(PointService);
  });

  describe('getUserPoint', () => {
    /**
     * 테스트 목적: 신규 사용자 처리 로직의 전체 플로우 검증
     * 테스트 시나리오: 처음 가입한 사용자의 포인트 조회
     * 검증 내용:
     * - 데이터베이스에 기록이 없는 사용자도 정상 처리
     * - 기본값 0 포인트 반환
     * - 시스템 안정성 (예외 발생하지 않음)
     * 통합 테스트 의미: 실제 데이터베이스 연동까지 포함한 완전한 플로우 검증
     */
    it('신규 사용자의 경우 0 포인트를 반환해야 한다', async () => {
      // given
      const userId = 1;

      // when
      const result = await service.getUserPoint(userId);

      // then
      expect(result.id).toBe(userId);
      expect(result.point).toBe(0);
      expect(result.updateMillis).toBeDefined();
    });

    /**
     * 테스트 목적: 충전 후 조회의 데이터 일관성 검증
     * 테스트 시나리오: 포인트 충전 → 즉시 조회하여 반영 확인
     * 검증 내용:
     * - 충전 작업과 조회 작업 간의 데이터 일관성
     * - 실제 데이터베이스에 정확히 저장되었는지 확인
     * - 서비스 메서드 간 연동 검증
     * 통합 테스트 중요성: 실제 운영 환경에서의 동작 시뮬레이션
     */
    it('포인트를 충전한 후 조회하면 충전된 포인트가 반환되어야 한다', async () => {
      // given
      const userId = 1;
      const chargeAmount = 1000;

      // when: 서비스를 통해 포인트 충전
      await service.chargePoint(userId, chargeAmount);
      const result = await service.getUserPoint(userId);

      // then
      expect(result.id).toBe(userId);
      expect(result.point).toBe(chargeAmount);
    });
  });

  describe('chargePoint', () => {
    /**
     * 테스트 목적: 포인트 충전의 전체 비즈니스 플로우 검증
     * 테스트 시나리오: 기존 포인트 + 새로운 충전 = 누적된 최종 포인트
     * 검증 내용:
     * - 두 번의 연속 충전이 정확히 누적되는지 확인
     * - 각 충전 시점의 포인트 상태 검증
     * - 데이터베이스 업데이트의 정확성 확인
     * - 실제 조회를 통한 최종 검증
     * 통합 테스트 의미: 실제 서비스 사용 패턴과 동일한 시나리오 검증
     */
    it('유효한 금액으로 포인트를 충전해야 한다', async () => {
      // given
      const userId = 1;
      const firstCharge = 1000;
      const secondCharge = 500;

      // when: 첫 번째 충전
      const firstResult = await service.chargePoint(userId, firstCharge);

      // then: 첫 번째 충전 확인
      expect(firstResult.id).toBe(userId);
      expect(firstResult.point).toBe(firstCharge);
      expect(firstResult.updateMillis).toBeDefined();

      // when: 두 번째 충전
      const secondResult = await service.chargePoint(userId, secondCharge);

      // then: 누적 충전 확인
      expect(secondResult.point).toBe(firstCharge + secondCharge);

      // 최종 포인트 조회로 검증
      const finalPoint = await service.getUserPoint(userId);
      expect(finalPoint.point).toBe(firstCharge + secondCharge);
    });

    /**
     * 테스트 목적: 포인트 충전 시 히스토리 기록의 정확성 검증
     * 테스트 시나리오: 충전 → 히스토리 조회하여 기록 확인
     * 검증 내용:
     * - 히스토리 테이블에 정확한 데이터 저장 확인
     * - 트랜잭션 타입(CHARGE) 정확성
     * - 사용자 ID, 금액 정보의 정확성
     * - 감사 추적(Audit Trail) 기능 검증
     * 통합 테스트 중요성: 실제 데이터베이스 트랜잭션까지 포함한 완전한 검증
     */
    it('충전 내역이 포인트 히스토리에 기록되어야 한다', async () => {
      // given
      const userId = 1;
      const chargeAmount = 500;

      // when
      await service.chargePoint(userId, chargeAmount);

      // then
      const histories = await service.getPointHistories(userId);
      expect(histories).toHaveLength(1);
      expect(histories[0].userId).toBe(userId);
      expect(histories[0].amount).toBe(chargeAmount);
      expect(histories[0].type).toBe(TransactionType.CHARGE);
    });

    it('0 이하의 금액으로 충전 시 예외가 발생해야 한다', async () => {
      // given
      const userId = 1;
      const invalidAmount = 0;

      // when & then
      await expect(service.chargePoint(userId, invalidAmount)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.chargePoint(userId, invalidAmount)).rejects.toThrow(
        '충전 금액은 0보다 커야 합니다.',
      );
    });

    it('음수 금액으로 충전 시 예외가 발생해야 한다', async () => {
      // given
      const userId = 1;
      const negativeAmount = -100;

      // when & then
      await expect(service.chargePoint(userId, negativeAmount)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('연속적인 충전이 정확히 누적되어야 한다', async () => {
      // given
      const userId = 1;
      const firstCharge = 500;
      const secondCharge = 300;

      // when
      await service.chargePoint(userId, firstCharge);
      const result = await service.chargePoint(userId, secondCharge);

      // then
      expect(result.point).toBe(firstCharge + secondCharge);

      // 히스토리 확인
      const histories = await service.getPointHistories(userId);
      expect(histories).toHaveLength(2);
      expect(histories.every((h) => h.type === TransactionType.CHARGE)).toBe(
        true,
      );
    });
  });

  describe('usePoint', () => {
    it('충분한 포인트가 있을 때 포인트를 사용해야 한다', async () => {
      // given
      const userId = 1;
      const chargeAmount = 1000;
      const useAmount = 300;
      // 먼저 포인트 충전
      await service.chargePoint(userId, chargeAmount);

      // when
      const result = await service.usePoint(userId, useAmount);

      // then
      expect(result.id).toBe(userId);
      expect(result.point).toBe(chargeAmount - useAmount);
      expect(result.updateMillis).toBeDefined();

      // 최종 포인트 조회로 검증
      const finalPoint = await service.getUserPoint(userId);
      expect(finalPoint.point).toBe(chargeAmount - useAmount);
    });

    it('사용 내역이 포인트 히스토리에 기록되어야 한다', async () => {
      // given
      const userId = 1;
      const chargeAmount = 1000;
      const useAmount = 300;
      // 먼저 포인트 충전
      await service.chargePoint(userId, chargeAmount);

      // when
      await service.usePoint(userId, useAmount);

      // then
      const histories = await service.getPointHistories(userId);
      expect(histories).toHaveLength(2); // 충전 + 사용
      // 최신순 정렬이므로 사용 내역이 첫 번째
      expect(histories[0].userId).toBe(userId);
      expect(histories[0].amount).toBe(useAmount);
      expect(histories[0].type).toBe(TransactionType.USE);
      // 충전 내역이 두 번째
      expect(histories[1].type).toBe(TransactionType.CHARGE);
      expect(histories[1].amount).toBe(chargeAmount);
    });

    it('포인트가 부족할 때 예외가 발생해야 한다', async () => {
      // given
      const userId = 1;
      const chargeAmount = 100;
      const useAmount = 500;
      // 작은 금액만 충전
      await service.chargePoint(userId, chargeAmount);

      // when & then
      await expect(service.usePoint(userId, useAmount)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.usePoint(userId, useAmount)).rejects.toThrow(
        '포인트가 부족합니다.',
      );
    });

    it('0 이하의 금액으로 사용 시 예외가 발생해야 한다', async () => {
      // given
      const userId = 1;
      const invalidAmount = 0;

      // when & then
      await expect(service.usePoint(userId, invalidAmount)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.usePoint(userId, invalidAmount)).rejects.toThrow(
        '사용 금액은 0보다 커야 합니다.',
      );
    });

    it('음수 금액으로 사용 시 예외가 발생해야 한다', async () => {
      // given
      const userId = 1;
      const negativeAmount = -100;

      // when & then
      await expect(service.usePoint(userId, negativeAmount)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('정확히 보유한 포인트만큼 사용할 수 있어야 한다', async () => {
      // given
      const userId = 1;
      const chargeAmount = 1000;
      // 포인트 충전
      await service.chargePoint(userId, chargeAmount);

      // when: 충전한 금액 전체를 사용
      const result = await service.usePoint(userId, chargeAmount);

      // then
      expect(result.point).toBe(0);
      // 최종 포인트 조회로 검증
      const finalPoint = await service.getUserPoint(userId);
      expect(finalPoint.point).toBe(0);
    });
  });

  describe('getPointHistories', () => {
    it('빈 히스토리 목록을 반환해야 한다', async () => {
      // given
      const userId = 1;

      // when
      const result = await service.getPointHistories(userId);

      // then
      expect(result).toEqual([]);
    });

    it('포인트 히스토리를 최신순으로 정렬하여 반환해야 한다', async () => {
      // given
      const userId = 1;

      // when: 여러 트랜잭션 실행 (시간차를 두기 위해 비동기 처리)
      await service.chargePoint(userId, 1000);
      await new Promise((resolve) => setTimeout(resolve, 10)); // 시간차 보장
      await service.usePoint(userId, 300);
      await new Promise((resolve) => setTimeout(resolve, 10)); // 시간차 보장
      await service.chargePoint(userId, 500);

      // then
      const histories = await service.getPointHistories(userId);
      expect(histories).toHaveLength(3);

      // 최신순 정렬 확인 (timeMillis가 큰 순서)
      for (let i = 0; i < histories.length - 1; i++) {
        expect(histories[i].timeMillis).toBeGreaterThanOrEqual(
          histories[i + 1].timeMillis,
        );
      }

      // 트랜잭션 타입 순서 확인
      expect(histories[0].type).toBe(TransactionType.CHARGE); // 마지막 충전
      expect(histories[0].amount).toBe(500);
      expect(histories[1].type).toBe(TransactionType.USE); // 사용
      expect(histories[1].amount).toBe(300);
      expect(histories[2].type).toBe(TransactionType.CHARGE); // 첫 번째 충전
      expect(histories[2].amount).toBe(1000);
    });

    it('특정 사용자의 히스토리만 반환해야 한다', async () => {
      // given
      const userId1 = 1;
      const userId2 = 2;

      // when
      await service.chargePoint(userId1, 1000);
      await service.chargePoint(userId2, 2000);
      await service.usePoint(userId1, 300);

      // then
      const user1Histories = await service.getPointHistories(userId1);
      const user2Histories = await service.getPointHistories(userId2);

      expect(user1Histories).toHaveLength(2);
      expect(user2Histories).toHaveLength(1);

      expect(user1Histories.every((h) => h.userId === userId1)).toBe(true);
      expect(user2Histories.every((h) => h.userId === userId2)).toBe(true);
    });
  });

  describe('사용자 시나리오 테스트', () => {
    it('충전 -> 사용 -> 재충전 시나리오가 정상 동작해야 한다', async () => {
      // given
      const userId = 1;

      // when: 시나리오 실행
      // 1. 1000 포인트 충전
      const chargeResult1 = await service.chargePoint(userId, 1000);
      expect(chargeResult1.point).toBe(1000);

      // 2. 300 포인트 사용
      const useResult = await service.usePoint(userId, 300);
      expect(useResult.point).toBe(700);

      // 3. 500 포인트 재충전
      const chargeResult2 = await service.chargePoint(userId, 500);
      expect(chargeResult2.point).toBe(1200);

      // then: 최종 상태 확인
      const finalPoint = await service.getUserPoint(userId);
      expect(finalPoint.point).toBe(1200);

      const histories = await service.getPointHistories(userId);
      expect(histories).toHaveLength(3);
    });

    /**
     * 테스트 목적: 다중 사용자 환경에서의 독립성 검증
     * 테스트 시나리오: 서로 다른 2명의 사용자가 동시에 포인트 거래
     * 검증 내용:
     * - 사용자별 독립적인 락 동작 확인
     * - 사용자A와 사용자B의 트랜잭션이 서로 영향 주지 않음
     * - 병렬 처리를 통한 성능 최적화 확인
     * - 각 사용자별 정확한 잔액 및 히스토리 관리
     * 확장성 관점: 실제 다중 사용자 서비스 환경 시뮬레이션
     */
    it('여러 사용자의 동시 트랜잭션이 독립적으로 처리되어야 한다', async () => {
      // given
      const user1 = 1;
      const user2 = 2;

      // when: 동시 트랜잭션
      await Promise.all([
        service.chargePoint(user1, 1000),
        service.chargePoint(user2, 2000),
      ]);

      await Promise.all([
        service.usePoint(user1, 300),
        service.usePoint(user2, 500),
      ]);

      // then: 각 사용자별 독립적 처리 확인
      const user1Point = await service.getUserPoint(user1);
      const user2Point = await service.getUserPoint(user2);

      expect(user1Point.point).toBe(700);
      expect(user2Point.point).toBe(1500);

      const user1Histories = await service.getPointHistories(user1);
      const user2Histories = await service.getPointHistories(user2);

      expect(user1Histories).toHaveLength(2);
      expect(user2Histories).toHaveLength(2);
    });

    /**
     * 테스트 목적: 실패한 트랜잭션의 원자성(Atomicity) 검증
     * 테스트 시나리오: 잔액 부족으로 인한 포인트 사용 실패
     * 검증 내용:
     * - 예외 발생 시 데이터 변경 없음 (롤백)
     * - 실패한 트랜잭션이 히스토리에 기록되지 않음
     * - 기존 포인트 잔액 유지
     * - All-or-Nothing 원칙 준수
     * 데이터 무결성: 부분적 실행 방지, 일관된 상태 유지 보장
     */
    it('잔액 부족 상황에서 트랜잭션이 실패해도 히스토리에 기록되지 않아야 한다', async () => {
      // given
      const userId = 1;
      await service.chargePoint(userId, 100);

      // when: 잔액 부족으로 실패하는 사용 시도
      await expect(service.usePoint(userId, 500)).rejects.toThrow();

      // then: 실패한 트랜잭션은 히스토리에 기록되지 않음
      const histories = await service.getPointHistories(userId);
      expect(histories).toHaveLength(1); // 충전 내역만 존재
      expect(histories[0].type).toBe(TransactionType.CHARGE);

      // 포인트도 변경되지 않음
      const currentPoint = await service.getUserPoint(userId);
      expect(currentPoint.point).toBe(100);
    });
  });

  describe('동시성 제어 테스트', () => {
    /**
     * 테스트 목적: 동시성 제어 메커니즘의 실제 동작 검증
     * 테스트 시나리오: 같은 사용자에 대한 3개의 동시 충전 요청
     * 검증 내용:
     * - Race Condition 방지 확인
     * - 순차 처리를 통한 정확한 누적 계산
     * - MemoryLockManager의 실제 동작 검증
     * - 데이터 무결성 보장
     * 통합 테스트 중요성: 실제 동시 요청 상황에서의 시스템 안정성 검증
     */
    it('동시 충전 요청이 정상적으로 처리되어야 한다', async () => {
      const requestPromise = [
        service.chargePoint(1, 1000),
        service.chargePoint(1, 500),
        service.chargePoint(1, 300),
      ];

      await Promise.all(requestPromise);

      const result = await service.getUserPoint(1);

      expect(result.point).toBe(1800);
    });

    /**
     * 테스트 목적: 포인트 사용 시 동시성 제어 검증
     * 테스트 시나리오: 충분한 잔액 준비 후 3개의 동시 사용 요청
     * 검증 내용:
     * - 잔액 차감의 정확성 (순차 처리)
     * - 잔액 부족 방지 (마이너스 포인트 방지)
     * - 동시 요청에도 안전한 잔액 관리
     * - 최종 잔액의 정확성 검증
     * 비즈니스 중요성: 금융 서비스에서 가장 중요한 동시성 이슈 해결 검증
     */
    it('동시 사용 요청이 정상적으로 처리되어야 한다', async () => {
      await service.chargePoint(1, 10000);

      const requestPromise = [
        service.usePoint(1, 1000),
        service.usePoint(1, 500),
        service.usePoint(1, 300),
      ];

      await Promise.all(requestPromise);

      const result = await service.getUserPoint(1);

      expect(result.point).toBe(8200);
    });

    it('충전/사용 혼합 요청이 정상적으로 처리되어야 한다', async () => {
      await service.chargePoint(1, 10000);

      const requestPromise = [
        service.usePoint(1, 1000),
        service.chargePoint(1, 500),
      ];

      await Promise.all(requestPromise);

      const result = await service.getUserPoint(1);

      expect(result.point).toBe(9500);
    });
  });
});
