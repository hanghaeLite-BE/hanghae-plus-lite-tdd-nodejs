import { Injectable } from '@nestjs/common';
import { LockManager } from './lock.manager';

// 메모리 기반 락 관리
@Injectable()
export class MemoryLockManager implements LockManager {
  private locks = new Map<string, Promise<void>>();
  private timeouts = new Map<string, NodeJS.Timeout>();

  async withLock<T>(
    key: string,
    operation: () => Promise<T>,
    timeoutMs: number = 5000,
  ): Promise<T> {
    // 기존 락 대기
    const maxWaitTime = Date.now() + timeoutMs;

    while (this.locks.has(key)) {
      if (Date.now() > maxWaitTime) {
        throw new Error(`Lock timeout for key: ${key}`);
      }
      await this.locks.get(key);
    }

    // 락 생성
    let resolve: () => void;
    const lockPromise = new Promise<void>((r) => (resolve = r));
    this.locks.set(key, lockPromise);

    // 타임아웃 설정 (데드락 방지)
    const timeout = setTimeout(() => {
      this.locks.delete(key);
      resolve!();
    }, timeoutMs);
    this.timeouts.set(key, timeout);

    try {
      return await operation();
    } finally {
      // 정리
      clearTimeout(this.timeouts.get(key)!);
      this.timeouts.delete(key);
      this.locks.delete(key);
      resolve!();
    }
  }
}
