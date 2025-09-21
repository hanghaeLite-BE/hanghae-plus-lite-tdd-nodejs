import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/database/database.module';
import { MemoryLockManager } from 'src/utils/memory-lock.manager';
import { PointController } from './point.controller';
import { PointService } from './point.service';

@Module({
  imports: [DatabaseModule],
  controllers: [PointController],
  providers: [PointService, MemoryLockManager],
})
export class PointModule {}
