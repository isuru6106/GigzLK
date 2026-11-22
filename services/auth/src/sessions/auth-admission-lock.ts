import { ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';

type LockedControl = {
  id: string;
  epoch: string;
  enabled: boolean;
  activeHour: bigint;
  closedThroughHour: bigint;
};

export type AdmissionLock = {
  epoch: string;
  activeHour: bigint;
  closedThroughHour: bigint;
  now: Date;
};

export function admissionUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'AUTH_UNAVAILABLE',
    message: 'Authentication is temporarily unavailable.',
  });
}

// Call inside the transaction that performs the protected operation.
// Always acquire this lock before reservation, attempt or account locks.
export async function lockAdmissionControl(
  transaction: Prisma.TransactionClient,
): Promise<AdmissionLock> {
  const controls = await transaction.$queryRaw<LockedControl[]>`
    SELECT
      "id",
      "epoch",
      "enabled",
      "activeHour",
      "closedThroughHour"
    FROM "AuthAdmissionControl"
    WHERE "id" = 'admission'
    FOR UPDATE
  `;

  const control = controls[0];

  if (
    !control ||
    !control.enabled ||
    control.activeHour < 0n ||
    control.closedThroughHour < -1n ||
    control.closedThroughHour >= control.activeHour
  ) {
    throw admissionUnavailable();
  }

  // Read time after acquiring the lock, not before waiting for it.
  const clocks = await transaction.$queryRaw<{ now: Date }[]>`
    SELECT clock_timestamp() AS "now"
  `;

  const now = clocks[0]?.now;

  if (
    !(now instanceof Date) ||
    !Number.isSafeInteger(now.getTime()) ||
    now.getTime() < 0
  ) {
    throw admissionUnavailable();
  }

  const databaseHour = BigInt(Math.floor(now.getTime() / (60 * 60 * 1000)));

  // Fail closed during rollback across an hourly boundary.
  // Never lower the persisted active or closed boundary.
  if (databaseHour < control.activeHour) {
    throw admissionUnavailable();
  }

  let closedThroughHour = control.closedThroughHour;

  if (databaseHour > control.activeHour) {
    await transaction.authAdmissionNamespace.updateMany({
      where: {
        epoch: control.epoch,
        hour: { lt: databaseHour },
        closedAt: null,
      },
      data: { closedAt: now },
    });

    closedThroughHour = databaseHour - 1n;

    await transaction.authAdmissionControl.update({
      where: { id: 'admission' },
      data: {
        activeHour: databaseHour,
        closedThroughHour,
      },
    });
  }

  return {
    epoch: control.epoch,
    activeHour: databaseHour,
    closedThroughHour,
    now,
  };
}
