import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AssertionAdmissionService } from './assertion-admission.service';
import { extractServiceAssertion } from './assertion-bearer';
import { resolveInternalAuthOperation } from './assertion-operation';
import { buildBffPermissions } from './assertion-permissions';

type InternalAuthRequest = Pick<
  Request,
  'method' | 'originalUrl' | 'rawHeaders'
>;

@Injectable()
export class InternalAuthHttpService {
  private readonly isAllowed:
    ReturnType<typeof buildBffPermissions> | undefined;

  constructor(private readonly admission: AssertionAdmissionService) {
    const marketplaceIssuer = process.env.AUTH_MARKETPLACE_BFF_ISSUER;
    const adminIssuer = process.env.AUTH_ADMIN_BFF_ISSUER;

    if (marketplaceIssuer === undefined && adminIssuer === undefined) {
      this.isAllowed = undefined;
      return;
    }

    this.isAllowed = buildBffPermissions({
      marketplaceIssuer: marketplaceIssuer ?? '',
      adminIssuer: adminIssuer ?? '',
    });
  }

  execute<T>(
    request: InternalAuthRequest,
    operation: (issuer: string) => T | Promise<T>,
  ): Promise<T> {
    const target = resolveInternalAuthOperation(
      request.method,
      request.originalUrl,
    );

    if (target === undefined) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'The requested resource was not found.',
      });
    }

    const token = extractServiceAssertion(request.rawHeaders);
    const isAllowed = this.isAllowed;

    if (isAllowed === undefined) {
      throw new ServiceUnavailableException({
        code: 'AUTH_UNAVAILABLE',
        message: 'Authentication is temporarily unavailable.',
      });
    }

    return this.admission.execute(
      token,
      (issuer) => isAllowed(issuer, target),
      operation,
    );
  }
}
