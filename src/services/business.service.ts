import { prisma } from "../lib/prisma.js";

import {
  upsertBusinessContext
} from "./businessContext.service.js";

export async function saveBusiness(
  userId: string,
  data: any
) {
  return upsertBusinessContext(
    userId,
    data
  );
}

export async function getBusiness(
  userId: string
) {
  const business =
    await prisma.businessContext.findUnique({
      where: {
        userId,
      },
    });

  return business;
}