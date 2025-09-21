import {
  anyNumber,
  anyString,
  anything,
  instance,
  mock,
  reset,
  verify,
  when,
} from '@johanblumenberg/ts-mockito';
import { BadRequestException } from '@nestjs/common';
import { PointHistoryTable } from 'src/database/pointhistory.table';
import { UserPointTable } from 'src/database/userpoint.table';
import { TransactionType } from 'src/point/point.model';
import { PointService } from 'src/point/point.service';
import { MemoryLockManager } from 'src/utils/memory-lock.manager';

describe('PointService', () => {
  let pointService: PointService;
  let mockUserPointTable: UserPointTable;
  let mockPointHistoryTable: PointHistoryTable;
  let mockMemoryLockManager: MemoryLockManager;

  beforeEach(() => {
    mockUserPointTable = mock(UserPointTable);
    mockPointHistoryTable = mock(PointHistoryTable);
    mockMemoryLockManager = mock(MemoryLockManager);

    // MemoryLockManager의 withLock 메서드 Mock 설정
    when(mockMemoryLockManager.withLock(anyString(), anything())).thenCall(
      (key: string, operation: () => Promise<any>) => operation(),
    );

    pointService = new PointService(
      instance(mockUserPointTable),
      instance(mockPointHistoryTable),
      instance(mockMemoryLockManager),
    );
  });

  afterEach(() => {
    reset(mockUserPointTable);
    reset(mockPointHistoryTable);
    reset(mockMemoryLockManager);
  });

  describe('getUserPoint', () => {
    /**
     * 테스트 목적: 기본적인 포인트 조회 기능이 정상 동작하는지 검증
     * 테스트 시나리오: 기존 사용자의 포인트 정보를 조회
     * 검증 내용:
     * - 올바른 사용자 ID 반환
     * - 정확한 포인트 금액 반환
     * - 업데이트 시간 정보 반환
     * Mock 사용 이유: 데이터베이스 의존성 없이 서비스 로직만 단독 테스트
     */
    it('유저 ID로 포인트를 조회할 수 있다.', async () => {
      const mockUserPoint = {
        id: 1,
        point: 5000,
        updateMillis: new Date('2025-01-01').getTime(),
      };

      when(mockUserPointTable.selectById(1)).thenReturn(
        Promise.resolve(mockUserPoint),
      );

      const result = await pointService.getUserPoint(1);

      expect(result.id).toBe(1);
      expect(result.point).toBe(5000);
      expect(result.updateMillis).toBe(mockUserPoint.updateMillis);
    });

    /**
     * 테스트 목적: 신규 사용자 또는 존재하지 않는 사용자 처리 로직 검증
     * 테스트 시나리오: 시스템에 등록되지 않은 사용자 ID로 포인트 조회
     * 검증 내용:
     * - 기본값 0 포인트 반환 (비즈니스 요구사항)
     * - 예외 발생하지 않고 정상 처리
     * 테스트 중요성: 신규 사용자의 첫 포인트 조회 시 안정성 보장
     */
    it('존재하지 않는 유저의 포인트를 조회하면 기본값(0 포인트)을 반환한다.', async () => {
      when(mockUserPointTable.selectById(999)).thenReturn(
        Promise.resolve({
          id: 999,
          point: 0,
          updateMillis: Date.now(),
        }),
      );

      const result = await pointService.getUserPoint(999);

      expect(result.id).toBe(999);
      expect(result.point).toBe(0);
    });
  });

  describe('chargePoint', () => {
    /**
     * 테스트 목적: 정상적인 포인트 충전 기능의 핵심 로직 검증
     * 테스트 시나리오: 기존 포인트에 새로운 금액을 충전
     * 검증 내용:
     * - 기존 포인트 + 충전 금액 = 최종 포인트 (산술 연산 정확성)
     * - 사용자 ID 일치성
     * - 응답 데이터 구조 검증
     * Mock 활용: 데이터베이스 조회 결과를 제어하여 순수 비즈니스 로직만 테스트
     */
    it('포인트를 충전할 수 있다.', async () => {
      const currentPoint = {
        id: 1,
        point: 1000,
        updateMillis: new Date('2025-01-01').getTime(),
      };

      when(mockUserPointTable.selectById(1)).thenReturn(
        Promise.resolve(currentPoint),
      );

      const result = await pointService.chargePoint(1, 5000);

      expect(result.id).toBe(1);
      expect(result.point).toBe(6000); // 1000 + 5000
    });

    /**
     * 테스트 목적: 잘못된 입력값에 대한 유효성 검증 로직 테스트
     * 테스트 시나리오: 0원 또는 음수 금액으로 충전 시도
     * 검증 내용:
     * - BadRequestException 예외 발생 확인
     * - 비즈니스 룰 준수 (0보다 큰 금액만 충전 가능)
     * - 데이터베이스 조작 없이 예외 처리 (빠른 실패)
     * 테스트 중요성: 잘못된 요청으로 인한 데이터 무결성 보호
     */
    it('0 이하의 금액으로 충전하려고 하면 에러를 발생시킨다.', async () => {
      await expect(pointService.chargePoint(1, 0)).rejects.toThrow(
        BadRequestException,
      );

      await expect(pointService.chargePoint(1, -1000)).rejects.toThrow(
        BadRequestException,
      );
    });

    /**
     * 테스트 목적: 포인트 충전 시 히스토리 기록 기능 검증
     * 테스트 시나리오: 포인트 충전 후 히스토리 테이블에 정확한 정보 저장 확인
     * 검증 내용:
     * - PointHistoryTable.insert 메서드 호출 확인
     * - 올바른 파라미터 전달 (사용자ID, 금액, 트랜잭션타입, 시간)
     * - 정확히 1번만 호출되는지 확인
     * Mock verify 사용 이유: 외부 의존성 호출 여부를 정확히 검증
     */
    it('포인트 충전 내역이 히스토리에 기록된다.', async () => {
      const currentPoint = {
        id: 1,
        point: 1000,
        updateMillis: new Date('2025-01-01').getTime(),
      };

      when(mockUserPointTable.selectById(1)).thenReturn(
        Promise.resolve(currentPoint),
      );

      await pointService.chargePoint(1, 5000);

      verify(
        mockPointHistoryTable.insert(
          1,
          5000,
          TransactionType.CHARGE,
          anyNumber(),
        ),
      ).once();
    });
  });

  describe('usePoint', () => {
    /**
     * 테스트 목적: 정상적인 포인트 사용 기능의 핵심 로직 검증
     * 테스트 시나리오: 충분한 잔액이 있을 때 포인트 차감 동작
     * 검증 내용:
     * - 보유 포인트 - 사용 금액 = 최종 포인트 (산술 연산 정확성)
     * - 잔액 충분 조건에서 정상 처리
     * - 사용자 ID 일치성 확인
     * 경계값 테스트: 보유 포인트와 동일한 금액 사용 (잔액 0원)
     */
    it('보유한 잔액이 사용할 금액보다 큰 경우, 포인트를 사용할 수 있다.', async () => {
      when(mockUserPointTable.selectById(1)).thenReturn(
        Promise.resolve({
          id: 1,
          point: 10000,
          updateMillis: new Date('2025-01-01').getTime(),
        }),
      );

      const result = await pointService.usePoint(1, 10000);

      expect(result.id).toBe(1);
      expect(result.point).toBe(0);
    });

    /**
     * 테스트 목적: 잔액 부족 상황에서의 예외 처리 로직 검증
     * 테스트 시나리오: 보유 포인트보다 많은 금액 사용 시도
     * 검증 내용:
     * - BadRequestException 예외 발생 확인
     * - 잔액 부족 조건 정확히 판단
     * - 데이터 변경 없이 안전한 실패 처리
     * 비즈니스 중요성: 마이너스 잔액 방지, 금융 서비스 신뢰성 확보
     */
    it('보유한 잔액이 사용할 금액보다 작은 경우, 포인트를 사용할 수 없다.', async () => {
      when(mockUserPointTable.selectById(1)).thenReturn(
        Promise.resolve({
          id: 1,
          point: 3000,
          updateMillis: new Date('2025-01-01').getTime(),
        }),
      );

      await expect(pointService.usePoint(1, 10000)).rejects.toThrow(
        BadRequestException,
      );
    });

    /**
     * 테스트 목적: 포인트 사용 시 입력값 유효성 검증
     * 테스트 시나리오: 0원 또는 음수 금액으로 포인트 사용 시도
     * 검증 내용:
     * - 잘못된 입력값에 대한 즉시 예외 발생
     * - 비즈니스 룰 적용 (양수 금액만 사용 가능)
     * - 데이터베이스 조회 없이 빠른 실패
     * 보안 측면: 악의적인 요청이나 시스템 오류로 인한 잘못된 데이터 방지
     */
    it('0 이하의 금액으로 사용하려고 하면 에러를 발생시킨다.', async () => {
      await expect(pointService.usePoint(1, 0)).rejects.toThrow(
        BadRequestException,
      );

      await expect(pointService.usePoint(1, -1000)).rejects.toThrow(
        BadRequestException,
      );
    });

    /**
     * 테스트 목적: 포인트 사용 시 히스토리 기록 기능 검증
     * 테스트 시나리오: 포인트 사용 후 히스토리 테이블에 사용 내역 저장 확인
     * 검증 내용:
     * - PointHistoryTable.insert 메서드 호출 확인
     * - 사용 트랜잭션 타입(USE) 정확히 기록
     * - 사용자 ID, 사용 금액, 시간 정보 정확 전달
     * 감사 추적: 모든 포인트 사용 내역의 완전한 기록 보장
     */
    it('포인트 사용 내역이 히스토리에 기록된다.', async () => {
      when(mockUserPointTable.selectById(1)).thenReturn(
        Promise.resolve({
          id: 1,
          point: 10000,
          updateMillis: new Date('2025-01-01').getTime(),
        }),
      );

      await pointService.usePoint(1, 5000);

      verify(
        mockPointHistoryTable.insert(1, 5000, TransactionType.USE, anyNumber()),
      ).once();
    });
  });

  describe('getPointHistories', () => {
    /**
     * 테스트 목적: 포인트 히스토리 조회 및 정렬 기능 검증
     * 테스트 시나리오: 여러 트랜잭션이 있는 사용자의 히스토리 조회
     * 검증 내용:
     * - 전체 히스토리 개수 확인
     * - 시간 기준 내림차순 정렬 확인 (최신 거래가 먼저)
     * - 각 트랜잭션의 타입 정확성 검증
     * 비즈니스 가치: 사용자에게 명확한 거래 내역 제공, 최신 활동 우선 표시
     */
    it('유저의 포인트 사용/충전 내역을 조회할 수 있다.', async () => {
      const mockHistories = [
        {
          id: 1,
          userId: 1,
          amount: 1000,
          type: TransactionType.CHARGE,
          timeMillis: new Date('2025-01-01').getTime(),
        },
        {
          id: 2,
          userId: 1,
          amount: 500,
          type: TransactionType.USE,
          timeMillis: new Date('2025-01-02').getTime(),
        },
      ];

      when(mockPointHistoryTable.selectAllByUserId(1)).thenReturn(
        Promise.resolve(mockHistories),
      );

      const result = await pointService.getPointHistories(1);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe(TransactionType.USE);
      expect(result[1].type).toBe(TransactionType.CHARGE);
    });

    it('포인트 내역이 없는 유저의 경우 빈 배열을 반환한다.', async () => {
      when(mockPointHistoryTable.selectAllByUserId(999)).thenReturn(
        Promise.resolve([]),
      );

      const result = await pointService.getPointHistories(999);

      expect(result).toEqual([]);
    });

    it('포인트 내역이 시간순으로 정렬되어 반환된다.', async () => {
      const mockHistories = [
        {
          id: 2,
          userId: 1,
          amount: 500,
          type: TransactionType.USE,
          timeMillis: new Date('2025-01-01').getTime(),
        },
        {
          id: 1,
          userId: 1,
          amount: 1000,
          type: TransactionType.CHARGE,
          timeMillis: new Date('2025-01-04').getTime(),
        },
      ];

      when(mockPointHistoryTable.selectAllByUserId(1)).thenReturn(
        Promise.resolve(mockHistories),
      );

      const result = await pointService.getPointHistories(1);

      expect(result[0].timeMillis).toBeGreaterThan(result[1].timeMillis);
    });
  });
});
