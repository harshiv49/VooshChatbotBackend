// src/utils/prisma.ts
import { PrismaClient } from "@prisma/client";

// This helps with type augmentation for globalThis
declare global {
  var prisma: PrismaClient | undefined;
}

// Instantiate a single PrismaClient instance.
// This prevents creating too many database connections during hot-reloading in development.
// 'globalThis.prisma' is used to preserve the instance across reloads.
const prisma =
  globalThis.prisma ||
  new PrismaClient({
    // Optional: You can add logging to see the queries Prisma is making.
    // log: ['query', 'info', 'warn', 'error'],
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = prisma;
}

export default prisma;
