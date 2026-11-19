import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { createDatabaseOptions } from './database.options';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        ...createDatabaseOptions({
          DATABASE_URL: config.get<string>('DATABASE_URL'),
          DATABASE_SSL: config.get<string>('DATABASE_SSL'),
        }),
        retryAttempts: 1,
      }),
    }),
  ],
})
export class DatabaseModule {}
