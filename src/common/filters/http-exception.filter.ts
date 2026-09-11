import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';

/**
 * Database-level failures that describe an ordinary client mistake rather than
 * a server fault. Without this mapping every one of them surfaced as a 500
 * "Unhandled Exception" — deleting an already-deleted row, for instance, took
 * down the request instead of answering "not found".
 */
const PRISMA_ERRORS: Record<string, { status: HttpStatus; code: string; message: string }> = {
  P2025: {
    status: HttpStatus.NOT_FOUND,
    code: 'NOT_FOUND',
    message: 'That record no longer exists. It may have already been deleted.',
  },
  P2002: {
    status: HttpStatus.CONFLICT,
    code: 'ALREADY_EXISTS',
    message: 'That already exists.',
  },
  P2003: {
    status: HttpStatus.BAD_REQUEST,
    code: 'RELATED_RECORD_MISSING',
    message: 'This refers to something that does not exist.',
  },
  P2014: {
    status: HttpStatus.CONFLICT,
    code: 'IN_USE',
    message: 'Something else still depends on this, so it cannot be removed.',
  },
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal Server Error';
    let code = 'INTERNAL_SERVER_ERROR';
    let details: any = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const errorObj = res as any;
        message = errorObj.message || message;
        code = errorObj.error || code;
        details = errorObj.details || null;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = PRISMA_ERRORS[exception.code];

      if (mapped) {
        status = mapped.status;
        code = mapped.code;
        message = mapped.message;

        // Name the offending field on a uniqueness clash so the message is
        // actionable rather than just "that already exists".
        const target = (exception.meta as any)?.target;
        if (exception.code === 'P2002' && Array.isArray(target) && target.length) {
          message = `That already exists (${target.join(', ')}).`;
        }

        this.logger.warn(`${exception.code} on ${request.url}: ${message}`);
      } else {
        this.logger.error(`Prisma ${exception.code} on ${request.url}: ${exception.message}`);
        message =
          process.env.NODE_ENV === 'production'
            ? 'An unexpected database error occurred'
            : exception.message;
      }
    } else if (exception instanceof Error) {
      this.logger.error(`Unhandled Exception: ${exception.message}`, exception.stack);
      message = process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : exception.message;
    }

    const flatMessage = Array.isArray(message) ? message.join(', ') : message;

    response.status(status).send({
      success: false,
      // Top-level `message` is what the dashboard and mobile app read, so the
      // real reason for a rejection reaches the user instead of a generic
      // fallback.
      message: flatMessage,
      error: {
        code,
        message: flatMessage,
        details,
      },
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
