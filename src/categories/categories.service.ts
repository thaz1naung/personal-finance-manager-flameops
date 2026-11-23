import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { MAX_CATEGORY_TOTAL } from './categories.constants';
import type { AddAmountDto } from './dto/add-amount.dto';
import type { CategoryResponseDto } from './dto/category-response.dto';
import type { CreateCategoryDto } from './dto/create-category.dto';
import { Category } from './entities/category.entity';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categories: Repository<Category>,
  ) {}

  async create(dto: CreateCategoryDto): Promise<CategoryResponseDto> {
    const category = this.categories.create({ name: dto.name.trim() });

    try {
      return this.toResponse(await this.categories.save(category));
    } catch (error: unknown) {
      if (error instanceof QueryFailedError) {
        const driverError = error.driverError as {
          code?: string;
          constraint?: string;
        };

        if (
          driverError.code === '23505' &&
          driverError.constraint === 'uq_categories_name_lower'
        ) {
          throw new ConflictException(
            'A category with this name already exists.',
          );
        }
      }

      throw error;
    }
  }

  addAmount(id: string, dto: AddAmountDto): Promise<CategoryResponseDto> {
    return this.categories.manager.transaction(async (manager) => {
      const categories = manager.getRepository(Category);
      const category = await categories.findOne({
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });

      if (!category) {
        throw new NotFoundException(`Category "${id}" was not found.`);
      }

      // The row stays locked until commit, including the limit check and save.
      // Bounded numeric(12,2) values convert exactly to safe integer cents.
      const currentCents = Math.round(Number(category.totalAmount) * 100);
      const amountCents = Math.round(dto.amount * 100);
      const nextTotalCents = currentCents + amountCents;

      if (nextTotalCents > MAX_CATEGORY_TOTAL * 100) {
        throw new BadRequestException(
          `A category total cannot exceed ${MAX_CATEGORY_TOTAL}.`,
        );
      }

      category.totalAmount = (nextTotalCents / 100).toFixed(2);
      return this.toResponse(await categories.save(category));
    });
  }

  async findAll(): Promise<CategoryResponseDto[]> {
    const categories = await this.categories.find({
      order: { createdAt: 'ASC', id: 'ASC' },
    });
    return categories.map((category) => this.toResponse(category));
  }

  private toResponse(category: Category): CategoryResponseDto {
    return {
      id: category.id,
      name: category.name,
      totalAmount: Number(category.totalAmount),
    };
  }
}
