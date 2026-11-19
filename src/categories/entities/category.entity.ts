import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MAX_CATEGORY_TOTAL } from '../categories.constants';

@Entity('categories')
@Check(
  'chk_categories_name_trimmed',
  'char_length(btrim("name")) > 0 AND "name" = btrim("name")',
)
@Check(
  'chk_categories_total_amount_range',
  `"total_amount" >= 0 AND "total_amount" <= ${MAX_CATEGORY_TOTAL}`,
)
// Expression indexes are managed by the migration, not schema generation.
@Index('uq_categories_name_lower', { synchronize: false })
@Index('idx_categories_created_at_id', ['createdAt', 'id'])
export class Category {
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'pk_categories' })
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  // PostgreSQL numeric values are read as strings to preserve decimal precision.
  @Column({
    name: 'total_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
  })
  totalAmount!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
