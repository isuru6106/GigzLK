import {
  Controller,
  Get,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';
import { AccessSigningKeyService } from './access-signing-key.service';

@Controller('.well-known')
export class AccessJwksController {
  constructor(private readonly signingKeys: AccessSigningKeyService) {}

  @Get('jwks.json')
  getJwks(@Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');

    try {
      const jwks = this.signingKeys.getPublicJwks();

      response.setHeader('Cache-Control', 'public, max-age=60');

      return jwks;
    } catch {
      throw new ServiceUnavailableException({
        code: 'AUTH_UNAVAILABLE',
        message: 'Access-token discovery is unavailable.',
      });
    }
  }
}
