import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database.service';
import {
  admissionUnavailable,
  lockAdmissionControl,
} from './auth-admission-lock';

@Injectable()
export class AuthAdmissionNamespaceService {
  constructor(private readonly database: DatabaseService) {}

  // Internal only. This does not authorize a browser or reserve an attempt.
  async current(): Promise<{
    namespaceId: string;
    epoch: string;
  }> {
    try {
      return await this.database.client.$transaction(async (transaction) => {
        const control = await lockAdmissionControl(transaction);

        let namespace = await transaction.authAdmissionNamespace.findUnique({
          where: {
            epoch_hour: {
              epoch: control.epoch,
              hour: control.activeHour,
            },
          },
        });

        if (namespace?.closedAt !== null && namespace !== null) {
          throw admissionUnavailable();
        }

        if (!namespace) {
          namespace = await transaction.authAdmissionNamespace.create({
            data: {
              epoch: control.epoch,
              hour: control.activeHour,
              openedAt: control.now,
            },
          });
        }

        return {
          namespaceId: namespace.id,
          epoch: namespace.epoch,
        };
      });
    } catch {
      throw admissionUnavailable();
    }
  }
}
