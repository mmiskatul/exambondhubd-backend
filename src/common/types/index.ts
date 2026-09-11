export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  QUESTION_EDITOR = 'QUESTION_EDITOR',
  QUESTION_REVIEWER = 'QUESTION_REVIEWER',
  SUPPORT = 'SUPPORT',
  USER = 'USER',
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  PENDING = 'PENDING',
}

export enum DifficultyLevel {
  EASY = 'EASY',
  MEDIUM = 'MEDIUM',
  HARD = 'HARD',
  ANY = 'ANY',
}

export enum QuestionType {
  SINGLE_MCQ = 'SINGLE_MCQ',
  MULTIPLE_MCQ = 'MULTIPLE_MCQ',
  TRUE_FALSE = 'TRUE_FALSE',
}

export enum QuestionSource {
  PREVIOUS_YEAR = 'PREVIOUS_YEAR',
  ADMIN_CREATED = 'ADMIN_CREATED',
  USER_SUBMITTED = 'USER_SUBMITTED',
}

export enum QuestionStatus {
  DRAFT = 'DRAFT',
  PENDING_REVIEW = 'PENDING_REVIEW',
  APPROVED = 'APPROVED',
  PUBLISHED = 'PUBLISHED',
  REJECTED = 'REJECTED',
  ARCHIVED = 'ARCHIVED',
}

export enum AttemptStatus {
  CREATED = 'CREATED',
  IN_PROGRESS = 'IN_PROGRESS',
  SUBMITTED = 'SUBMITTED',
  AUTO_SUBMITTED = 'AUTO_SUBMITTED',
  EXPIRED = 'EXPIRED',
  ABANDONED = 'ABANDONED',
}

export enum SubscriptionPlanCode {
  FREE = 'FREE',
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
  LIFETIME = 'LIFETIME',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

export enum PaymentProvider {
  BKASH = 'BKASH',
  NAGAD = 'NAGAD',
  ROCKET = 'ROCKET',
  SSLCOMMERZ = 'SSLCOMMERZ',
  MANUAL = 'MANUAL',
  DEMO = 'DEMO',
}

export enum ReportReason {
  WRONG_ANSWER = 'WRONG_ANSWER',
  INCORRECT_QUESTION = 'INCORRECT_QUESTION',
  TYPO = 'TYPO',
  DUPLICATE = 'DUPLICATE',
  OUTDATED = 'OUTDATED',
  OTHER = 'OTHER',
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
