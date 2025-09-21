/**
 * 락 관리자 인터페이스
 * 락 획득 후 작업 수행
 * @param key 락 키
 * @param operation 락 획득 후 작업
 * @param timeoutMs 락 획득 타임아웃 시간
 * @returns 작업 결과
 */
export interface LockManager {
  withLock<T>(
    key: string,
    operation: () => Promise<T>,
    timeoutMs: number,
  ): Promise<T>;
}
