import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponseWrapper<T> {
  success: boolean;
  data: T;
  message?: string;
}

/** Fallbacks used when a service does not supply its own message. */
const DEFAULT_MESSAGES: Record<string, string> = {
  POST: 'Created successfully.',
  PATCH: 'Updated successfully.',
  PUT: 'Updated successfully.',
  DELETE: 'Deleted successfully.',
};

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponseWrapper<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponseWrapper<T>> {
    const method = context.switchToHttp().getRequest()?.method as string;

    return next.handle().pipe(
      map((resData) => {
        // A service that already shaped its own envelope keeps it, but still
        // gets a message if it did not set one — the clients toast on this.
        if (resData && typeof resData === 'object' && 'success' in resData) {
          const shaped = resData as any;
          if (!shaped.message && DEFAULT_MESSAGES[method]) {
            shaped.message = DEFAULT_MESSAGES[method];
          }
          return shaped;
        }

        return {
          success: true,
          data: resData ?? null,
          // Reads are silent on the client; writes get something meaningful.
          message: DEFAULT_MESSAGES[method] ?? null,
        };
      }),
    );
  }
}
